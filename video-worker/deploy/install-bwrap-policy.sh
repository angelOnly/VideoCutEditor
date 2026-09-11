#!/usr/bin/env bash
# Run as the Worker user. Only policy installation/loading uses sudo.
set -euo pipefail
policy_dir=$(cd -- "$(dirname -- "$0")/apparmor" && pwd)
policy_source="$policy_dir/bwrap-userns-restrict"
policy_target=/etc/apparmor.d/videocut-bwrap-userns
if [[ $(sysctl -n kernel.apparmor_restrict_unprivileged_userns 2>/dev/null || true) != 1 ]]; then
  exit 0
fi
probe_bwrap() {
  # Trusted /usr/bin/true only. Match the task's NoNewPrivileges and private network.
  systemd-run --user --wait --pipe --collect --quiet --service-type=exec \
    --property=NoNewPrivileges=yes \
    /usr/bin/bwrap --die-with-parent --new-session --unshare-all \
    --ro-bind / / -- /usr/bin/true
}
if probe_output=$(probe_bwrap 2>&1); then
  echo 'Bubblewrap namespace probe passed; existing AppArmor configuration retained.'
  exit 0
fi
if ! printf '%s' "$probe_output" | grep -Eq 'Failed RTM_NEWADDR|No permissions to create new namespace|Creating new namespace failed'; then
  printf '%s\n' "$probe_output" >&2
  exit 1
fi
if [[ -e "$policy_target" || -L "$policy_target" ]]; then
  if [[ -L "$policy_target" ]] || ! sudo cmp -s "$policy_source" "$policy_target"; then
    echo "Existing $policy_target differs; preserve it and have the administrator review AppArmor denials." >&2
    exit 1
  fi
else
  # Do not overwrite or bypass an administrator/distribution profile for bwrap.
  # Include disabled policies in the check: disabling may be intentional.
  existing=$(sudo grep -rlE '/usr/bin/bwrap|profile[[:space:]]+(bwrap|unpriv_bwrap)([[:space:]]|$)' /etc/apparmor.d || [[ $? == 1 ]])
  loaded=$(sudo cat /sys/kernel/security/apparmor/profiles)
  if [[ -n "$existing" ]] || printf '%s\n' "$loaded" | grep -Eq '(^|/)(bwrap|unpriv_bwrap)([ /]|$)'; then
    echo 'An existing Bubblewrap AppArmor policy needs administrator review; no policy was replaced.' >&2
    printf '%s\n' "$existing" "$probe_output" >&2
    exit 1
  fi
fi
# Compile before changing /etc; parser failure leaves the existing system untouched.
sudo apparmor_parser -Q -T -I /etc/apparmor.d "$policy_source"
echo 'Installing dedicated /usr/bin/bwrap AppArmor policy; global userns restriction stays enabled.'
sudo install -o root -g root -m 0644 "$policy_source" "$policy_target"
sudo apparmor_parser -r -T "$policy_target"
if ! probe_output=$(probe_bwrap 2>&1); then
  printf 'Bubblewrap is still blocked. Worker remains stopped. Inspect kernel AppArmor logs.\n%s\n' "$probe_output" >&2
  exit 1
fi
echo 'Bubblewrap AppArmor namespace probe passed.'
