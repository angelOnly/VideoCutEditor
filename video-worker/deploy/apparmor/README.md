# Bubblewrap AppArmor policy

Unmodified policy from AppArmor v4.0.1 (ABI 4.0, compatible with Ubuntu 24.04):
https://gitlab.com/apparmor/apparmor/-/blob/v4.0.1/profiles/apparmor/profiles/extras/bwrap-userns-restrict

SHA-256: `11d39094f044f0cda0febb3ad517b830301da6b2ce929664af09ee9e4dd264f9`.
The upstream GPL-2.0 license is included as LICENSE and applies to this vendored policy.

Ubuntu recommends a dedicated Bubblewrap policy:
https://discourse.ubuntu.com/t/understanding-apparmor-user-namespace-restriction/58007

The policy allows Bubblewrap to create namespaces and configure loopback; executed
children enter a stacked profile that denies capabilities. It does not give the
Worker host root permissions. This policy attaches to /usr/bin/bwrap, so it also
affects other applications using that executable. The installer preserves any
existing system policy and never changes the global user namespace restriction.
The task mount/network isolation and systemd limits remain enforced by the Worker.
