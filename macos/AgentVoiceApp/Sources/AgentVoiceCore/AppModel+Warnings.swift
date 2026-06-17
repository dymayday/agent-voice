import Foundation

@MainActor
public extension AppModel {
    func clearDashboardWarnings() async {
        guard let status else {
            await refresh()
            return
        }

        let shouldResolveSystemPause = status.ui.attention.contains("system_paused")
        let shouldResolveFailedJobs =
            status.ui.attention.contains("failed_jobs") || hasUnresolvedDoctorCheck("queue.failed.empty")
        let shouldResolveDaemonState =
            status.ui.attention.contains("stale_daemon_lock") ||
            status.ui.state == .daemonStopped ||
            hasUnresolvedDoctorCheck("daemon.running")

        if shouldResolveSystemPause {
            await resume()
        }
        if shouldResolveFailedJobs {
            await clearFailedJobs()
        }
        if shouldResolveDaemonState {
            await startDaemon()
        }
    }

    private func hasUnresolvedDoctorCheck(_ checkId: String) -> Bool {
        doctorReport?.checks.contains { check in
            check.id == checkId && !check.ok
        } == true
    }
}
