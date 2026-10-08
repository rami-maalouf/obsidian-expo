import Foundation
import os

/// logs launch stages as milliseconds after the process started, once each per process, so a
/// device launch can be broken down in Console (subsystem com.ramimaalouf.obsidianexpo,
/// category launch). "first note editable" is the "returning cold launch to editable today"
/// target in the plan's verification contract. ios can prewarm an app before the tap, so a
/// prewarmed launch reads longer than the user waited.
enum LaunchTiming {
  private static let log = Logger(subsystem: "com.ramimaalouf.obsidianexpo", category: "launch")
  private static let started = processStartTime()
  private static let lock = NSLock()
  private static var marked = Set<String>()

  /// logs `stage` the first time it happens in this process, with an optional `detail` such as
  /// a count. safe from any thread.
  static func mark(_ stage: String, detail: String = "") {
    lock.lock()
    let first = marked.insert(stage).inserted
    lock.unlock()
    guard first, let start = started else {
      return
    }
    let elapsed = Int((Date().timeIntervalSince1970 - start) * 1000)
    log.notice("\(stage, privacy: .public) \(elapsed, privacy: .public) ms after process start\(detail, privacy: .public)")
  }

  /// logs once per process; `kind` says what the note showed, for example "editable".
  static func firstNoteShown(_ kind: String) {
    lock.lock()
    let first = marked.insert("first note").inserted
    lock.unlock()
    if first {
      mark("first note \(kind)")
    }
  }

  /// when the kernel started this process, in seconds since 1970.
  private static func processStartTime() -> TimeInterval? {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
    guard sysctl(&mib, UInt32(mib.count), &info, &size, nil, 0) == 0 else {
      return nil
    }
    let start = info.kp_proc.p_un.__p_starttime
    return TimeInterval(start.tv_sec) + TimeInterval(start.tv_usec) / 1_000_000
  }
}
