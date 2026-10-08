import Foundation
import os

/// logs how long the first note took to show after the process started: the "returning cold
/// launch to editable today" target in the plan's verification contract. ios can prewarm an
/// app before the tap, so a prewarmed launch reads longer than the user waited.
@MainActor
enum LaunchTiming {
  private static let log = Logger(subsystem: "com.ramimaalouf.obsidianexpo", category: "launch")
  private static var reported = false

  /// logs once per process; `kind` says what the note showed, for example "editable".
  static func firstNoteShown(_ kind: String) {
    guard !reported else {
      return
    }
    reported = true
    guard let started = processStartTime() else {
      return
    }
    let elapsed = Int((Date().timeIntervalSince1970 - started) * 1000)
    log.notice("first note \(kind, privacy: .public) \(elapsed, privacy: .public) ms after process start")
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
