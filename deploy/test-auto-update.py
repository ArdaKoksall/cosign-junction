"""Linux deployment control tests; Docker/HTTP isolated, real Git revisions."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('cosign-update.sh').resolve()

class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / 'repo'
        self.state = self.root / 'state'
        self.events = self.root / 'events'
        self.run_cmd('git', 'init', '--bare', str(self.root / 'origin'))
        self.run_cmd('git', 'init', '-b', 'main', str(self.repo))
        self.git('config', 'user.email', 'deploy-test@example.invalid')
        self.git('config', 'user.name', 'Deployment test')
        (self.repo / 'version').write_text('1')
        self.git('add', '.')
        self.git('commit', '-m', 'initial')
        self.git('remote', 'add', 'origin', str(self.root / 'origin'))
        self.git('push', 'origin', 'main')
        self.sha = self.git('rev-parse', 'HEAD').stdout.strip()

    def run_cmd(self, *args):
        return subprocess.run(args, text=True, capture_output=True, check=True)

    def git(self, *args):
        return self.run_cmd('git', '-C', str(self.repo), *args)

    def update(self, fail='', legacy_running=False, legacy_storage='', migrated=False, migration_complete=True):
        env = dict(os.environ, COSIGN_REPO=str(self.repo),
                   COSIGN_DEPLOY_STATE=str(self.state), EVENTS=str(self.events), FAIL=fail,
                   LEGACY_RUNNING=str(int(legacy_running)), LEGACY_STORAGE=legacy_storage,
                   MIGRATED=str(int(migrated)), MIGRATION_COMPLETE=str(int(migration_complete)))
        shell = '''docker() {
          if [[ $1 == container && $2 == ls ]]; then
            if [[ $LEGACY_RUNNING == 1 ]]; then echo old-api; fi
            return 0
          fi
          if [[ $1 == volume && $2 == ls ]]; then
            case "$*" in
              *"name=orderguard-live_postgres"*) printf '%s\\n' "$LEGACY_STORAGE" ;;
              *"label=com.valio.cosign.migrated-from=orderguard-live_postgres"*)
                if [[ $MIGRATED == 1 ]]; then echo cosign-live_postgres; fi
                ;;
            esac
            return 0
          fi
          if [[ $1 == run && " $* " == *".cosign-migration-complete"* ]]; then
            [[ $MIGRATION_COMPLETE == 1 ]]
            return
          fi
          echo "docker $*" >> "$EVENTS"
          if [[ " $* " == *" port web 8080 "* ]]; then echo '127.0.0.1:8180'; fi
          if [[ $FAIL == build && " $* " == *" build "* ]]; then return 1; fi
        }
        curl() { echo "health ${*: -1}" >> "$EVENTS"; [[ $FAIL != health ]]; }
        export -f docker curl
        bash "$1"
        '''
        return subprocess.run(['bash', '-c', shell, 'test', str(SCRIPT)], env=env,
                              text=True, capture_output=True)

    def test_success_then_unchanged_skips_build(self):
        result = self.update()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((self.state / 'deployed-sha').read_text().strip(), self.sha)
        before = self.events.read_text()
        self.assertIn('--project-name cosign-live', before)
        self.assertIn('health http://127.0.0.1:8180/healthz', before)
        self.assertEqual(self.update().returncode, 0)
        self.assertEqual(self.events.read_text(), before)

    def test_failed_build_preserves_revision_and_retries(self):
        self.state.mkdir()
        (self.state / 'deployed-sha').write_text('previous\n')
        self.assertNotEqual(self.update('build').returncode, 0)
        self.assertEqual((self.state / 'deployed-sha').read_text(), 'previous\n')
        self.assertNotIn(' up ', self.events.read_text())
        self.assertEqual(self.update().returncode, 0)
        self.assertEqual((self.state / 'deployed-sha').read_text().strip(), self.sha)

    def test_failed_health_never_marks_success(self):
        self.assertNotEqual(self.update('health').returncode, 0)
        self.assertFalse((self.state / 'deployed-sha').exists())

    def test_dirty_checkout_refused(self):
        (self.repo / 'version').write_text('local edit')
        self.assertNotEqual(self.update().returncode, 0)
        self.assertFalse(self.events.exists())

    def test_existing_postgres_volume_must_be_migrated(self):
        result = self.update(legacy_storage='orderguard-live_postgres')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('migrate-docker-db.sh orderguard-live cosign-live', result.stderr)
        self.assertFalse(self.events.exists())
        result = self.update(legacy_storage='orderguard-live_postgres', migrated=True, migration_complete=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('no completion marker', result.stderr)
        self.assertFalse(self.events.exists())
        result = self.update(legacy_storage='orderguard-live_postgres', migrated=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_running_legacy_services_prevent_cosign_deployment(self):
        result = self.update(legacy_running=True, legacy_storage='orderguard-live_postgres', migrated=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Stop the old orderguard-live Compose services', result.stderr)
        self.assertFalse(self.events.exists())

    def test_lock_prevents_parallel_deployment(self):
        import fcntl
        self.state.mkdir()
        with (self.state / 'update.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(self.update().returncode, 0)
            self.assertFalse(self.events.exists())

if __name__ == '__main__':
    unittest.main()
