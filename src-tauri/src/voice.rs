// Speaking and hearing on this Mac, for a voice conversation (docs/voice.md):
//
//   * `voice_voices` -- the voices macOS speaks with (`say -v ?`);
//   * `voice_say` -- a sentence said by one of them, as a WAV the webview
//     plays itself, so it can be cut off mid-word when the reader talks over
//     it;
//   * `voice_hear` -- what was said in a WAV recording, written down by
//     Apple's recogniser with on-device recognition required: nothing the
//     reader says leaves the Mac.
//
// The microphone is the webview's own (getUserMedia). macOS asks for it the
// first time, with Info.plist's NSMicrophoneUsageDescription, and for speech
// recognition with NSSpeechRecognitionUsageDescription.

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
pub struct Voice {
    name: String,
    lang: String,
}

static NEXT: AtomicU64 = AtomicU64::new(0);

/* A file of our own in the temporary folder, for one recording or sentence. */
fn scratch(kind: &str) -> PathBuf {
    std::env::temp_dir().join(format!("blvrd-{kind}-{}-{}.wav", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)))
}

#[tauri::command]
pub async fn voice_voices() -> Result<Vec<Voice>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let out = Command::new("/usr/bin/say").args(["-v", "?"]).output().map_err(|e| format!("Couldn't ask macOS for its voices: {e}"))?;
        Ok(parse_voices(&String::from_utf8_lossy(&out.stdout)))
    })
    .await
    .map_err(|e| e.to_string())?
}

/* `say -v ?` lists a voice a line -- its name (which may have spaces and
   brackets: "Eddy (English (US))"), its locale, then # and a sample:

     Ava (Premium)       en_US    # Hello! My name is Ava. */
fn parse_voices(text: &str) -> Vec<Voice> {
    text.lines()
        .filter_map(|line| {
            let (head, _) = line.split_once('#')?;
            let head = head.trim_end();
            let at = head.rfind(char::is_whitespace)?;
            let (name, lang) = (head[..at].trim(), head[at..].trim());
            (!name.is_empty() && lang.contains('_')).then(|| Voice { name: name.to_string(), lang: lang.to_string() })
        })
        .collect()
}

/// One sentence said in `voice` (the Mac's own when none), at `rate` words a
/// minute (its usual pace when none), as the bytes of a WAV file. The words go
/// in on stdin, so nothing in them is read as an option.
#[tauri::command]
pub async fn voice_say(text: String, voice: Option<String>, rate: Option<u32>) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = scratch("say");
        let mut command = Command::new("/usr/bin/say");
        if let Some(voice) = voice.filter(|v| !v.is_empty()) {
            command.arg("-v").arg(voice);
        }
        if let Some(rate) = rate {
            command.arg("-r").arg(rate.clamp(80, 400).to_string());
        }
        command.arg("-o").arg(&path).args(["--file-format=WAVE", "--data-format=LEI16@24000"]);
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Couldn't start macOS speech: {e}"))?;
        // Dropped at the end of the statement: `say` reads to the end of stdin.
        child.stdin.take().ok_or("no stdin")?.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        let bytes = fs::read(&path);
        let _ = fs::remove_file(&path);
        if !out.status.success() {
            let why = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(if why.is_empty() { "macOS couldn't say that.".to_string() } else { why });
        }
        bytes.map(tauri::ipc::Response::new).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// What was said in the WAV recording sent as the request's body, in the
/// language its `x-language` header names ("en-GB"), as text.
#[tauri::command]
pub async fn voice_hear(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(wav) = request.body() else {
        return Err("voice_hear takes a recording".into());
    };
    let wav = wav.clone();
    let language = request.headers().get("x-language").and_then(|v| v.to_str().ok()).unwrap_or("en-US").to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let path = scratch("heard");
        fs::write(&path, &wav).map_err(|e| e.to_string())?;
        let text = hear(&path, &language);
        let _ = fs::remove_file(&path);
        text
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(not(target_os = "macos"))]
fn hear(_path: &std::path::Path, _language: &str) -> Result<String, String> {
    Err("Hearing on this computer needs macOS. Choose a speech server in Settings → Voice.".into())
}

#[cfg(target_os = "macos")]
fn hear(path: &std::path::Path, language: &str) -> Result<String, String> {
    use std::sync::mpsc;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::AllocAnyThread;
    use objc2_foundation::{NSError, NSLocale, NSOperationQueue, NSString, NSURL};
    use objc2_speech::{
        SFSpeechRecognitionResult, SFSpeechRecognitionTaskHint, SFSpeechRecognizer, SFSpeechURLRecognitionRequest,
    };

    // kAFAssistantErrorDomain's "no speech detected": nothing was said.
    const NO_SPEECH: isize = 1110;

    allowed()?;
    // SAFETY: Speech framework calls with live, retained arguments. The result
    // handler runs on the recogniser's own queue, not this thread, and only
    // sends on a channel; the recogniser and task are kept until it has.
    unsafe {
        let locale = NSLocale::initWithLocaleIdentifier(NSLocale::alloc(), &NSString::from_str(language));
        let recognizer = SFSpeechRecognizer::initWithLocale(SFSpeechRecognizer::alloc(), &locale)
            .ok_or_else(|| format!("This Mac can't recognise {language}. Choose another language in Settings → Voice."))?;
        if !recognizer.supportsOnDeviceRecognition() {
            return Err(format!(
                "This Mac can't recognise {language} on the device yet. Turn on Dictation for it in System Settings → Keyboard, which downloads it — or choose a speech server in Settings → Voice."
            ));
        }
        if !recognizer.isAvailable() {
            return Err("Speech recognition isn't available on this Mac right now.".into());
        }
        recognizer.setQueue(&NSOperationQueue::new());

        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        let request = SFSpeechURLRecognitionRequest::initWithURL(SFSpeechURLRecognitionRequest::alloc(), &url);
        request.setRequiresOnDeviceRecognition(true);
        request.setShouldReportPartialResults(false);
        request.setAddsPunctuation(true);
        request.setTaskHint(SFSpeechRecognitionTaskHint::Dictation);

        let (tx, rx) = mpsc::channel::<Result<String, String>>();
        let handler = RcBlock::new(move |result: *mut SFSpeechRecognitionResult, error: *mut NSError| {
            if let Some(error) = error.as_ref() {
                let _ = tx.send(if error.code() == NO_SPEECH { Ok(String::new()) } else { Err(error.localizedDescription().to_string()) });
            } else if let Some(result) = result.as_ref() {
                if result.isFinal() {
                    let _ = tx.send(Ok(result.bestTranscription().formattedString().to_string()));
                }
            }
        });
        let task = recognizer.recognitionTaskWithRequest_resultHandler(&request, &handler);
        let heard = rx.recv_timeout(Duration::from_secs(30)).unwrap_or_else(|_| {
            task.cancel();
            Err("Speech recognition took too long.".into())
        });
        drop(task);
        heard
    }
}

/* Whether blvrd may use speech recognition: asked the first time, as macOS
   wants, and said plainly when it was turned down. */
#[cfg(target_os = "macos")]
fn allowed() -> Result<(), String> {
    use std::sync::mpsc;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2_speech::{SFSpeechRecognizer, SFSpeechRecognizerAuthorizationStatus as Status};

    // SAFETY: class methods with no arguments but a block that only sends on
    // a channel, from whichever queue macOS calls it on.
    let mut status = unsafe { SFSpeechRecognizer::authorizationStatus() };
    if status == Status::NotDetermined {
        let (tx, rx) = mpsc::channel();
        let answered = RcBlock::new(move |status: Status| {
            let _ = tx.send(status);
        });
        unsafe { SFSpeechRecognizer::requestAuthorization(&answered) };
        // The reader is being asked; give them time to answer.
        status = rx.recv_timeout(Duration::from_secs(300)).unwrap_or(Status::NotDetermined);
    }
    match status {
        Status::Authorized => Ok(()),
        Status::NotDetermined => Err("blvrd is waiting to be allowed speech recognition.".into()),
        _ => Err("blvrd isn't allowed to use speech recognition. Allow it in System Settings → Privacy & Security → Speech Recognition, or choose a speech server in Settings → Voice.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_voice_list() {
        let list = "Albert              en_US    # Hello! My name is Albert.\n\
                    Ava (Premium)       en_US    # Hello! My name is Ava.\n\
                    Eddy (English (US)) en_US    # Hello! My name is Eddy.\n\
                    Amélie              fr_CA    # Bonjour, je m’appelle Amélie.\n\
                    \n";
        let voices = parse_voices(list);
        let names: Vec<_> = voices.iter().map(|v| (v.name.as_str(), v.lang.as_str())).collect();
        assert_eq!(names, [("Albert", "en_US"), ("Ava (Premium)", "en_US"), ("Eddy (English (US))", "en_US"), ("Amélie", "fr_CA")]);
    }
}
