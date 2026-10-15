# Deploy dev to AWS

`.github/workflows/deploy-aws.yml` deploys this branch to AWS. The separate
`deploy.yml` continues to deploy `main` to Lightsail.
Pushes to `dev` and manual runs selected on `dev` run the reusable frontend/backend
checks before building and publishing both images to ECR. The workflow assumes an
IAM role through GitHub OIDC, runs a single migration task, then deploys the image
pair by digest and verifies that the service completed that exact revision.
Manual runs on other branches cannot deploy. No long-lived AWS keys or runtime
secrets belong in GitHub.

`stack.yaml` creates an ECS Fargate cluster/service, two ECR repositories, CloudWatch
logs, an HTTPS ALB, encrypted EFS audio storage, and scoped execution/task/deploy
roles. Initialize the external release-state parameters first. It starts at **zero tasks**, so the stack can be created before images exist.
The first successful workflow runs migrations and sets the service to one task.
The `bootstrap` image references in the base definition are intentionally unused
until GitHub replaces them with actual image digests.

## Required account setup

Use the same AWS account and region for the stack, secret, ACM certificate, ECR,
PostgreSQL and Redis. Nothing in this repository supplies real credentials or
creates a database/cache, VPC, certificate, DNS record or account-wide OIDC provider.

1. Choose an existing VPC with two public ALB subnets and two private application
   subnets in distinct availability zones. Private subnets need DNS and NAT egress
   for Groq, Gemini, SMTP and AWS APIs/image pulls. AWS endpoints alone do not provide
   access to the external providers. Tasks do not receive public IPs.
2. Provide PostgreSQL (for example RDS PostgreSQL 17) and Redis/Valkey (for example
   ElastiCache) reachable from both private subnets. Enable database/cache encryption
   and backups as appropriate. After stack creation, allow their ports **from the
   stack's `TaskSecurityGroupId`**, rather than exposing either service publicly.
   Use a PostgreSQL application account allowed to migrate its schema.
3. Validate an ACM certificate in this region for the dev domain. Set `PublicAppUrl`
   to that HTTPS origin and select an explicit `AllowedHttpsCidr` for dev access.
   The ALB accepts HTTPS only. A restricted CIDR also restricts payment webhook
   callers; include the required callers through reviewed ingress rules if using
   SePay. Do not repoint the current production domain for this dev deployment.
4. Configure the account's IAM OIDC provider for
   `https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`.
   Reuse it if it already exists. The stack's role trusts exactly
   `repo:Huyvux12/lumi-ai:ref:refs/heads/dev`. If your GitHub OIDC subject uses IDs
   or a custom format, supply the exact dev subject with `GitHubOidcSubject`.
   The workflow intentionally has no GitHub environment, which would change `sub`.
5. Create a JSON secret in AWS Secrets Manager using the keys below. Supply its
   ARN to CloudFormation. ECS resolves the values at task startup; GitHub cannot
   read the secret. If using a customer-managed KMS key, set `SecretKmsKeyArn` and
   permit the execution role in the key policy. Preserve `MFA_ENCRYPTION_KEY` across
   deployments and data migration so existing MFA records remain decryptable.

Every referenced JSON key must exist. Empty strings are allowed only for optional
features; missing keys prevent ECS from starting the task.

| Secret JSON key | Value to supply |
| --- | --- |
| `DATABASE_URL` | `postgresql+asyncpg://<user>:<url-encoded-password>@<host>:5432/<db>?ssl=require` |
| `REDIS_URL` | `rediss://:<url-encoded-auth-token>@<host>:6379/0` for TLS Redis with token authentication; adapt to your cache's authentication configuration |
| `MFA_ENCRYPTION_KEY` | A real Fernet key generated once and kept stable |
| `GROQ_API_KEY`, `GOOGLE_API_KEY` | Real provider credentials; empty disables the corresponding feature |
| `SEPAY_ENV` | `test` for dev; never leave empty |
| `SEPAY_WEBHOOK_SECRET`, `SEPAY_API_TOKEN` | SePay sandbox credentials, or empty if payments are disabled |
| `SEPAY_BANK_CODE`, `SEPAY_ACCOUNT_NUMBER`, `SEPAY_ACCOUNT_HOLDER` | Your sandbox payment account configuration, or empty |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | SMTP STARTTLS settings on port 587 and verified sender; empty credentials only if supported by your SMTP server |

Production mode disables the local mail outbox; verification and recovery require
working SMTP. Other backend settings keep the defaults in `backend/.env.example`;
add non-secret environment entries to the base task definition when changing models,
SMTP port or payment prefix. Do not invent provider credentials to make startup pass.

## Optional AI provider credentials

`AIProviderSecretArn` defaults to empty and preserves existing deployments. Set it
when enabling Deepgram Nova-3 or OpenAI-compatible LLMs. It points to a separate
JSON secret injected as `AI_PROVIDER_CONFIG_JSON`; do not add required key references
to the existing backend secret just to enable this optional feature. See
[the provider guide](../../docs/ai-providers/README.md#aws-ecs) for its shape,
allowed endpoints and migration `c1d82e4f630a`. Use the same customer-managed KMS
key as the backend secret or the AWS-managed key, or separately grant decrypt on
the provider secret's key. Secret rotation requires a task restart.

## Bootstrap

Copy `parameters.example.json` outside the repository and replace every placeholder
with your existing resource identifiers. The parameter file contains ARNs, IDs, and the two SSM parameter names only,
never database passwords or provider keys. Use an authenticated infrastructure
administrator session with IAM/CloudFormation provisioning permissions and access to the two non-secret SSM release parameters:

```bash
# Creates /lumi/lumi-dev/task-definition and /lumi/lumi-dev/desired-count.
# For an existing stack, adopts its active service before the template update.
# Existing parameters are never overwritten.
AWS_DEFAULT_REGION=<aws-region> python scripts/init_release_state.py --stack-name lumi-dev

aws cloudformation deploy \
  --region <aws-region> \
  --stack-name lumi-dev \
  --template-file deploy/aws/stack.yaml \
  --parameter-overrides file:///absolute/path/to/parameters.json \
  --capabilities CAPABILITY_NAMED_IAM

aws cloudformation describe-stacks \
  --region <aws-region> --stack-name lumi-dev \
  --query 'Stacks[0].Outputs' --output table
```

Set `DesiredCountParameter` to `/lumi/<stack-name>/desired-count` and
`TaskDefinitionParameter` to `/lumi/<stack-name>/task-definition` in your parameter
file. These are **SSM names**, not resolved values. The infrastructure administrator
needs `ssm:GetParameters` when creating/updating the stack. Keep these parameters
outside the stack: deleting or updating infrastructure must not reset release state.

Stack creation incurs AWS charges even while the service has zero tasks (ALB,
storage and logging). The infrastructure administrator may also need permission
to create the ECS service-linked role in a new account. Stack names must be valid
lowercase ECR repository name prefixes; use `lumi-dev` or a similar lowercase name.

Create an alias/CNAME for the dev domain to `LoadBalancerDnsName` (the hosted zone
ID output supports Route 53 aliases). Configure the PostgreSQL/Redis security groups
as described above. Add these **GitHub repository Actions variables**, using the
stack outputs, under Settings → Secrets and variables → Actions → Variables:

| Variable | Value |
| --- | --- |
| `AWS_REGION` | The chosen region |
| `AWS_ROLE_ARN` | `DeployRoleArn` output |
| `AWS_STACK_NAME` | `lumi-dev`, or the exact stack name you created |

Then push to `dev` or manually dispatch **Deploy dev to AWS** on `dev`. Missing
variables fail the deployment job with their names and this guide's path.
`LIGHTSAIL_HOST`/`LIGHTSAIL_SSH_KEY` are only used by `main`. Compose and
`deploy/nginx.conf` remain available for the existing DO/local setup; they are not
used by the AWS workflow.

## Behavior and operations

- Frontend/backend share one Fargate task and communicate over `127.0.0.1:8000`.
  Next rewrites are compiled with that URL. Changing a runtime env variable does
  not change the compiled destination. Browser API traffic remains same-origin.
  Standalone output includes both `public` and `.next/static` in the Docker image.
- The backend command in ECS overrides the Docker default to run only Uvicorn.
  Migrations and seed run once in a backend-only task before the service update.
  Migrations must remain compatible with the currently running revision; a failed
  migration can have committed schema changes even though the service was untouched.
  Back up the database before schema changes. Database rollback is an operator task.
- Keep exactly one application task and one Uvicorn worker: chat/audio cancellation
  currently uses process-local task state. Replacement stops the old task before
  starting the new task, causing a brief interruption and ending active streams.
  EFS retains cached audio; the access point enforces UID/GID 1000 and private
  directory permissions matching the Docker user. Do not enable autoscaling until
  streaming ownership/cancellation work across processes.
- Backend readiness checks the database; frontend starts after backend is healthy.
  ALB health checks `/welcome` (the home page redirects first-time visitors).
  ALB idle timeout is 300 seconds; streams that emit no data for longer will close.
  ECS has a deployment circuit breaker. On the first deployment there is no prior
  healthy revision to roll back to. Later rollbacks fail the workflow's revision
  check even when the ECS stability waiter succeeds.
- Image tags include commit SHA, run ID and attempt so reruns work with immutable
  ECR tags. Runtime images use digests. Repositories and EFS are retained on stack
  deletion; maintain a deliberate image retention policy that preserves rollback
  releases and manage retained resources explicitly. EFS backups are enabled.
  Canonical task revisions are retained so adopted service references remain valid;
  prune old task definitions only after checking service and release-state references.
- CloudFormation owns the canonical task configuration. After verifying a release,
  Actions publishes the complete task revision and count 1 to the two non-secret
  SSM parameters. Stack updates resolve those values and preserve the last verified
  service; bootstrap is used only while count is 0. New canonical configuration
  takes effect in the next Actions release, after migration and health checks.
  Serialize infrastructure updates with deployments. Actions can write only these
  two release parameters and cannot mutate IAM or CloudFormation infrastructure.
  Before upgrading an existing stack to this template, run `init_release_state.py`
  to adopt its service, then supply the two new parameter names during the update.
- For manual rollback, an operator selects a previously successful service task
  definition in ECS and updates this service with desired count 1, then verifies
  health and schema compatibility. Once verified, publish that revision to
  `/lumi/<stack-name>/task-definition` and `1` to `/lumi/<stack-name>/desired-count`
  using `aws ssm put-parameter --type String --overwrite`, so later stack updates
  preserve the rollback. Do not roll back to the `bootstrap` definition.
  For secret rotation, restart using a known successful image revision; ECS resolves
  the current secret again. No secrets are printed in workflow output.
- Inspect the ECS migration/service tasks and the `LogGroupName` output when a run
  fails. Migration waiter timeout stops the task and aborts deployment. If a run is
  manually cancelled, verify no migration task is still running before retrying.
  Bootstrap the owner via the existing `app.cli bootstrap-owner` interactive command
  in a private administrative session; this workflow does not create users. Payment
  reconciliation worker deployment is separate, as in the existing DO configuration.

## Validation

```bash
cfn-lint deploy/aws/stack.yaml
actionlint
python -m unittest discover -s scripts/tests -v
```

The reusable checks also run frontend typecheck/lint/build and backend tests against
SQLite and PostgreSQL, plus PostgreSQL Alembic upgrade/schema-drift checks. A live
AWS deploy requires the above account setup; passing local validation does not
verify account quotas, network routes, DNS, certificates or secret values.

The container check builds both actual Dockerfiles and smoke tests the startup,
frontend assets and API rewrite with the same shared network layout as ECS. It uses
only a disposable SQLite database and runs without AWS credentials.

References: [CloudFormation SSM parameter types](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cloudformation-supplied-parameter-types.html),
[GitHub OIDC with AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws),
[ECS EFS volumes](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/efs-volumes.html),
[Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output).
