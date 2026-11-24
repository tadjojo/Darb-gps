# DARB GPS on Oracle Cloud Always Free

This is an optional self-managed deployment target for the DARB API and, when
a real carrier APN/VPN is available, the GT06/NMEA raw-TCP gateway. It keeps
PostgreSQL and authentication on the existing Supabase project. It does not
create or migrate production data.

## Why this target

Oracle Cloud's published Always Free allowance includes up to 2 OCPUs and
12 GB RAM on Ampere A1 in the tenancy's home region, plus eligible block
storage. The free allocation is sufficient for a small Docker host, but
capacity is not guaranteed. Oracle may reclaim instances that meet its idle
criteria. Account verification may require a payment card; do not upgrade
the account or create paid resources for this deployment.

Official limits and caveats:
- https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm

## 1. Create only Always Free resources

In Oracle Cloud:
1. Create an account and select a home region you can continue using; Always
   Free compute must be provisioned in that home region.
2. Create a VM.Standard.A1.Flex instance with Ubuntu ARM64, using no more than
   2 OCPUs and 12 GB memory in total.
3. Keep the boot volume and all other resources within the Always Free-eligible
   quotas shown in the console.
4. Assign a public IPv4 address and create a public subnet with an internet
   gateway and route.
5. Do not click Upgrade and do not provision resources without the
   Always Free-eligible label. If A1 capacity is unavailable, wait or try a
   different availability domain in the home region; do not select paid shapes.

Oracle may ask for card verification. A free-tier account is not a promise of
capacity or an uptime SLA. Maintain backups outside the VM.

## 2. Configure the network before deployment

In the OCI VCN security list or network security group, allow:
- TCP 22 only from your own administrator public IP/CIDR.
- TCP 80 and 443 from the internet for Caddy HTTPS.
- TCP 5023 only from the carrier's confirmed GT06 APN/VPN egress CIDR(s),
  and only when the GPS gateway profile is enabled.
- TCP 5024 only from confirmed NMEA source CIDR(s), and only when NMEA is used.

Do not open 5432, 6379, Docker's 2375/2376, or any database port to the
internet. The API is reachable only through Caddy on HTTPS. For a live fleet,
the gateway must use a private APN/VPN or another trusted network path because
the tracker-to-gateway GT06 protocol is not encrypted by this adapter.

Ask the SIM carrier for the actual public egress/NAT ranges. The private IP
shown on a SIM is not necessarily the source IP seen by the VM. Do not use
0.0.0.0/0 as a substitute.

## 3. Install Docker and prepare the deployment directory

Install Docker Engine and the Compose plugin using Docker's official Ubuntu
instructions:
https://docs.docker.com/engine/install/ubuntu/

Then on the VM:

```sh
sudo mkdir -p /opt/darb-gps/deploy/oracle/secrets
sudo chown -R "$USER":"$USER" /opt/darb-gps
cd /opt/darb-gps
```

Download the repository's `deploy/oracle/` directory to
`/opt/darb-gps/deploy/oracle/` (or clone the public repository). Keep the
deployment files in sync with the GitHub main branch.

## 4. Configure the DNS name and Supabase connection

Create an A record for a DNS name you control, pointing to the VM's public
IPv4 address. Set a valid email address for ACME certificate notices.

Copy `.env.example` to `.env`, then set:
- `DARB_DOMAIN` and `ACME_EMAIL`
- `DATABASE_URL` from the Supabase project's Database connection settings
- `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`
- `CORS_ORIGINS` to the exact frontend origins

If Supabase's direct database endpoint is not reachable over IPv4 from the
VM, use the Supabase session pooler connection string. Do not place the
database password in Git, an issue, or a chat message.

The API currently requires the Supabase database CA certificate at
`/etc/secrets/prod-supabase.cer` when `NODE_ENV=production`. Obtain the
correct CA certificate from the Supabase project dashboard and place it at:

```sh
/opt/darb-gps/deploy/oracle/secrets/prod-supabase.cer
```

The CA certificate is public trust material, not a password. Keep the
environment file private and set the certificate readable by the non-root
container user:

```sh
chmod 600 .env
chmod 644 secrets/prod-supabase.cer
```

Do not start the API until the real connection string, publishable key, and
certificate are configured. Never use a fake password or placeholder in a
running service.

## 5. Publish the container images

The GitHub Actions workflow `.github/workflows/oracle-deploy.yml` validates
the deployment files, runs the GPS protocol and gateway tests, builds both
images for ARM64 and AMD64, and publishes them to GitHub Container Registry
(GHCR). The workflow uses GitHub Actions; it does not use Render build minutes.

After the first successful publish, open the two packages under the GitHub
account's Packages page and set their visibility to Public if you want the VM
to pull without a registry token. Otherwise configure a read-only GHCR token
on the VM; do not put it in the repository.

## 6. Start the HTTPS API

From `/opt/darb-gps/deploy/oracle`:

```sh
cp .env.example .env
# Edit .env with the real values described above.
docker compose -f compose.yml pull api caddy
docker compose -f compose.yml up -d api caddy
docker compose -f compose.yml ps
docker compose -f compose.yml logs --tail=100 api caddy
```

Caddy obtains and renews HTTPS certificates automatically once the DNS A
record points to the VM and inbound ports 80/443 are reachable. Verify:

```sh
curl --fail https://YOUR_DARB_DOMAIN/api/v1/health/live
curl --fail https://YOUR_DARB_DOMAIN/api/v1/health/ready
```

Only proceed when readiness reports the database as connected. Update the
mobile app's API base URL and the frontend CORS origin configuration before
switching users to this endpoint. Keep the old Render endpoint available
until the new endpoint has passed acceptance tests.

## 7. Enable the hardware gateway only after carrier/device setup

The gateway is deliberately disabled by default. Do not expose its ports with
placeholder values.

After enrolling a real GT06 device in DARB and obtaining its one-time
credential, copy `.env.gateway.example` to `.env.gateway`, then set:
- the new HTTPS API base URL
- the actual carrier APN/VPN egress CIDR(s)
- the actual 15-digit IMEI, its one-time bearer credential, and its assigned
  source CIDR(s)
- optional NMEA static source-IP mappings

Then enable the profile:

```sh
docker compose -f compose.yml --profile gps-gateway up -d
docker compose -f compose.yml ps
docker compose -f compose.yml logs --tail=100 gps-gateway
```

At OCI firewall level, restrict 5023/5024 to the same trusted CIDRs. The
gateway also enforces its own allowlists. A successful TCP connection is not
proof of hardware compatibility; test with one physical tracker and the
carrier before enrolling a fleet.

## 8. GitHub Actions deployment secrets

The workflow builds and publishes images even before a VM is connected. Its
remote deploy step is skipped until all of these GitHub repository secrets
exist:
- `OCI_SSH_HOST`: VM public IPv4 address
- `OCI_SSH_USER`: Ubuntu login user
- `OCI_SSH_PRIVATE_KEY`: private SSH key whose public half is in the VM's
  `authorized_keys`
- `OCI_SSH_KNOWN_HOSTS`: verified SSH host-key line for this VM
- `OCI_DEPLOY_DIR`: absolute path to this directory on the VM, e.g.
  `/opt/darb-gps/deploy/oracle`

Add these under GitHub repository Settings → Secrets and variables →
Actions → New repository secret. Never commit them. Do not use a password
login or expose the SSH private key in workflow output.

After adding the secrets, the next successful main-branch image build will
pull the exact commit-tagged images on the VM and restart the API and Caddy.
If `.env.gateway` exists on the VM, the workflow also deploys the gateway
profile. The workflow does not create an Oracle account, VM, DNS record, TLS
domain, Supabase credentials, carrier APN, or tracker enrollment.

## 9. Operations and limitations

- The VM is a single failure domain, not high availability. Use external
  backups and test restoration.
- Oracle's Always Free compute may be reclaimed when its published idle
  thresholds are met. Monitor CPU, memory, and network utilization.
- Keep OS security updates enabled and restrict SSH.
- Never expose Postgres, Redis, or the Docker daemon publicly.
- The API is stateful only through Supabase; the gateway keeps its device
  credential maps in environment configuration and must be restarted after
  enrollment, revocation, or credential rotation.
- This deployment does not establish that a physical GPS device, SIM carrier,
  or Jordanian APN/VPN is compatible. Field validation remains mandatory.
