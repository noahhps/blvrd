/* Stopping. A turn is stopped through one AbortSignal (App.jsx); these make
 * every wait in it give way to that signal, even a wait on something that
 * doesn't listen for it -- a connector's tool, an AppleScript, a question to
 * the reader. */

export const stoppedError = () => new DOMException("Stopped", "AbortError");

/** Throws if the turn has been stopped. */
export function checkStopped(signal) {
  if (signal?.aborted) throw stoppedError();
}

/** `promise`, unless the signal fires first: then it rejects at once with an
 *  AbortError. What was being waited on is left to finish (or fail) on its
 *  own; its result is ignored. */
export function untilStopped(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(stoppedError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(stoppedError());
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (problem) => {
        signal.removeEventListener("abort", onAbort);
        reject(problem);
      },
    );
  });
}

/** Whether a failure is a stop. The desktop's HTTP plugin rejects a cancelled
 *  request with "Request cancelled" rather than an AbortError, so the signal
 *  is the surer test when there is one. */
export const isStop = (problem, signal) => Boolean(signal?.aborted) || problem?.name === "AbortError";
