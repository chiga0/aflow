export type RunStatus =
  "created" | "queued" | "running" | "completed" | "failed" | "cancelled";

const API_BASE = getApiBase();

export interface RunSpec {
  prompt?: string | null;
  adapter: string;
  repo?: string | null;
  workspace?: string | null;
  model?: string | null;
  sandbox?: Record<string, unknown>;
  timeout_seconds?: number | null;
  metadata?: Record<string, unknown>;
}

export interface RunState {
  run_id: string;
  status: RunStatus;
  adapter_run_id?: string | null;
  created_at: string;
  updated_at: string;
  event_count: number;
  prompt_count: number;
  spec: RunSpec;
}

export interface RunInputResponse {
  accepted: boolean;
  run_id: string;
}

export interface RuntimeEvent {
  id: string;
  run_id: string;
  sequence: number;
  type: string;
  created_at: string;
  data: Record<string, unknown>;
}

export interface DaemonEvent {
  id: number | string;
  v: 1;
  type: string;
  data: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  originatorClientId?: string;
}

export interface ArtifactInfo {
  name: string;
  size_bytes: number;
  updated_at: string;
}

export interface TaskProgress {
  completed_steps: number;
  total_steps: number;
  percent: number;
}

export interface TaskState {
  task_id: string;
  kind: "run" | "mission" | string;
  title: string;
  goal: string;
  status: string;
  created_at: string;
  updated_at: string;
  progress: TaskProgress;
  agent_summary: Record<string, unknown>;
  needs_attention: boolean;
  pending_permission_count: number;
  access?: {
    created_by?: string;
    project_id?: string;
    visibility?: string;
  };
  source: { run_id?: string | null; mission_id?: string | null };
  result_summary?: string | null;
  links: Record<string, string>;
}

export interface TaskEvent {
  id: string;
  task_id: string;
  sequence: number;
  type: string;
  title: string;
  body?: string | null;
  status: string;
  created_at: string;
  source_event_type: string;
  source: Record<string, unknown>;
}

export interface TaskResult {
  task_id: string;
  status: string;
  summary?: string | null;
  artifacts: ArtifactInfo[];
  completed: boolean;
  generated_at: string;
}

export interface TaskCreateRequest {
  goal: string;
  mode?: "single" | "mission" | string;
  adapter?: string;
  model?: string | null;
  repo?: string | null;
  workspace?: string | null;
  strategy?: string;
  timeout_seconds?: number | null;
  metadata?: Record<string, unknown>;
}

export interface PermissionRequest {
  permission_id: string;
  prompt?: string;
  options?: Array<{ id: string; label?: string; description?: string }>;
  tool?: string;
  raw?: Record<string, unknown>;
}

export interface PermissionNotification {
  notification_id: string;
  run_id: string;
  permission_id: string;
  channel: string;
  target: string;
  status: string;
  attempts: number;
  message: string;
  action_url: string;
  delivery_ref?: string | null;
  error?: string | null;
  created_at: string;
  updated_at: string;
  sent_at?: string | null;
  metadata?: Record<string, unknown>;
}

export interface WorkerInfo {
  worker_id: string;
  status: string;
  capacity: number;
  active_count: number;
  heartbeat_at: string;
  lease_ttl_seconds: number;
  metadata?: Record<string, unknown>;
}

export interface QueueStatus {
  counts: Record<string, number>;
  jobs: Array<Record<string, unknown>>;
  workers: WorkerInfo[];
}

export interface WorkerControl {
  worker_id: string;
  draining: boolean;
  desired_state: string;
  runs: Array<Record<string, unknown>>;
  generated_at: string;
}

export interface WorkerRegistration {
  worker_id: string;
  capacity: number;
  control_url: string;
  token: ApiToken;
  metadata: Record<string, unknown>;
  deploy_command: string;
}

export interface ExecutorLease {
  executor_id: string;
  run_id: string;
  adapter: string;
  strategy: string;
  status: string;
  base_url?: string | null;
  workspace?: string | null;
  port?: number | null;
  pid?: number | null;
  started_at: string;
  heartbeat_at?: string | null;
  released_at?: string | null;
  exit_code?: number | null;
  last_error?: string | null;
  metadata: Record<string, unknown>;
}

export interface CostStatus {
  generated_at: string;
  status: string;
  config: Record<string, unknown>;
  month: string;
  monthly_estimated_cost_usd: number;
  monthly_budget_usd: number;
  warning_threshold_usd?: number | null;
  runs: Array<Record<string, unknown>>;
}

export interface DrillCheck {
  id: string;
  status: "pass" | "warn" | "fail" | string;
  summary: string;
  details: Record<string, unknown>;
}

export interface Capabilities {
  mode: string;
  features: string[];
  adapters: Record<
    string,
    { name: string; status?: string; features?: string[] }
  >;
  queue: QueueStatus;
  executor_registry?: Record<string, unknown>;
  profiles: AgentProfile[];
  permission_stall_policy?: { seconds: number; action: string };
  cleanup_policy?: Record<string, unknown>;
  ops_policy?: Record<string, unknown>;
}

export interface Metrics {
  generated_at: string;
  runs: { total: number; by_status: Record<string, number> };
  missions: { total: number; by_status: Record<string, number> };
  queue: {
    counts: Record<string, number>;
    worker_count: number;
    active_workers: number;
    stale_workers: number;
  };
  permissions: {
    pending: number;
    stalled: number;
    notifications?: Record<string, number>;
  };
  latency_seconds: { count: number; avg: number | null; p95: number | null };
}

export interface MissionTask {
  task_id: string;
  title: string;
  profile_id: string;
  status: string;
  run_id?: string | null;
  depends_on: string[];
  result?: Record<string, unknown>;
  profile_snapshot?: Record<string, unknown>;
}

export interface MissionState {
  mission_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  event_count: number;
  task_count: number;
  completed_task_count: number;
  failed_task_count: number;
  spec: { goal: string; strategy: string; adapter: string };
  tasks: MissionTask[];
}

export interface MissionEvent {
  id: string;
  mission_id: string;
  sequence: number;
  type: string;
  created_at: string;
  data: Record<string, unknown>;
}

export interface AgentProfile {
  id: string;
  display_name: string;
  description: string;
  version: number;
  source: string;
  runtime: Record<string, unknown>;
  tools: Record<string, unknown>;
  approval: Record<string, unknown>;
  limits: Record<string, unknown>;
  workspace: Record<string, unknown>;
  artifacts: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface AccessPolicy {
  mode: string;
  current_principal: {
    id: string;
    display_name: string;
    roles: string[];
  };
  roles: Array<{
    id: string;
    description: string;
    permissions: string[];
  }>;
  scopes: string[];
  projects?: AccessProject[];
  tokens?: ApiToken[];
  audit: Record<string, unknown>;
}

export interface AccessProject {
  project_id: string;
  display_name: string;
  description: string;
  status: string;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}

export interface ApiToken {
  token_id: string;
  name: string;
  principal_id: string;
  project_id?: string | null;
  scopes: string[];
  status: string;
  token_prefix: string;
  created_at: string;
  updated_at: string;
  revoked_at?: string | null;
  last_used_at?: string | null;
  metadata: Record<string, unknown>;
  token?: string;
}

export interface AuthUser {
  email: string;
  display_name: string;
  roles: string[];
  status: string;
  email_verified_at?: string | null;
  created_at: string;
  updated_at: string;
  last_login_at?: string | null;
  metadata: Record<string, unknown>;
}

export interface BackupInfo {
  name: string;
  size_bytes: number;
  created_at: string;
}

export interface P5Evaluation {
  id: string;
  status: string;
  mode: string;
  decision: string;
  entrypoints?: string[];
  required_env?: string;
}

export interface AuthSession {
  authenticated: boolean;
  login_required: boolean;
  principal?: {
    id: string;
    email?: string | null;
    display_name: string;
    roles: string[];
  } | null;
  auth_mode?: string;
}

export interface V2Progress {
  completed_steps: number;
  running_steps: number;
  total_steps: number;
  percent: number;
}

export interface V2AgentTask {
  agent_task_id: string;
  task_id: string;
  plan_id: string;
  role: string;
  title: string;
  goal: string;
  status: string;
  adapter: string;
  order_index: number;
  depends_on: string[];
  artifact_contract: Record<string, unknown>;
  result: Record<string, unknown>;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at: string;
}

export interface V2Plan {
  plan_id: string;
  task_id: string;
  version: number;
  status: string;
  strategy: string;
  graph: {
    strategy: string;
    nodes: Array<{ id: string; title: string; depends_on: string[] }>;
  };
  artifact_contract: Record<string, unknown>;
  agent_tasks: V2AgentTask[];
  created_at: string;
  updated_at: string;
}

export interface V2Task {
  task_id: string;
  tenant_id: string;
  project_id: string;
  created_by: string;
  title: string;
  goal: string;
  mode: string;
  status: string;
  priority: string;
  channel: string;
  adapter: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  progress: V2Progress;
  plan: V2Plan | null;
  result?: {
    summary: string;
    artifacts: Array<Record<string, unknown>>;
    evaluation: Record<string, unknown>;
  } | null;
  events?: V2Event[];
}

export interface ConversationExecution {
  execution_id: string;
  conversation_id: string;
  task_id: string;
  sequence: number;
  status: string;
  trigger_message: string;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  conversation_id: string;
  tenant_id: string;
  project_id: string;
  created_by: string;
  title: string;
  status: string;
  unread_count: number;
  pending_approval_count: number;
  pinned_at?: string | null;
  archived_at?: string | null;
  version: number;
  projection_version: number;
  last_meaningful_activity_at: string;
  created_at: string;
  updated_at: string;
  executions?: ConversationExecution[];
  latest_execution?: ConversationExecution | null;
}

export interface ConversationTextBlock {
  type: "text";
  text: string;
}

export interface ConversationEntityRefBlock {
  type: "entity_ref";
  entity_type: "plan" | "artifacts" | "approval" | string;
  entity_id: string;
  label: string;
}

export interface ConversationAttachmentBlock {
  type: "attachment";
  name: string;
  href?: string;
  media_type?: string;
}

export type ConversationContentBlock =
  | ConversationTextBlock
  | ConversationEntityRefBlock
  | ConversationAttachmentBlock;

export interface ConversationMessage {
  message_id: string;
  conversation_id: string;
  execution_id: string;
  cursor: number;
  role: "user" | "agent" | "system" | string;
  kind: "text" | "plan" | "brief" | "result" | "error" | "approval" | string;
  content: ConversationContentBlock[];
  created_at: string;
  revision: number;
}

export interface ConversationMessageCommand {
  conversation_id: string;
  execution_id: string;
  task_id: string;
  event: V2Event | null;
  created_execution: boolean;
}

export interface ConversationCanvasExecution extends ConversationExecution {
  plan: V2Plan | null;
  workflow: { run: V2WorkflowRun | null; steps: V2WorkflowStep[] };
  artifacts: V2Artifact[];
  evaluations: V2Evaluation[];
  replays: V2Replay[];
  events?: V2Event[];
  progress: V2Progress;
  result?: V2Task["result"];
}

export interface ConversationCanvas {
  conversation_id: string;
  projection_version: number;
  executions: ConversationCanvasExecution[];
  latest_execution: ConversationCanvasExecution | null;
}

export interface ConversationActivity {
  conversation_id: string;
  status: string;
  latest_execution: ConversationExecution | null;
  active_agent: V2AgentTask | null;
  progress: V2Progress | null;
  pending_approval_count: number;
  updated_at: string;
}

export interface ApprovalEvidence {
  type: string;
  label?: string;
  summary?: string;
  ref?: string;
  snippet?: string;
}

export interface ApprovalRequest {
  approval_id: string;
  conversation_id: string;
  execution_id: string;
  task_id: string;
  requested_by: string;
  intent: string;
  evidence: ApprovalEvidence[];
  impact: {
    level: "low" | "medium" | "high";
    summary: string;
    affected_resources: string[];
    reversible: boolean;
  };
  allowed_actions: Array<"approve" | "reject" | "pause" | "revise">;
  scope: Record<string, unknown>;
  status:
    | "pending"
    | "approved"
    | "rejected"
    | "expired"
    | "cancelled"
    | "paused"
    | "revision_requested";
  version: number;
  expires_at?: string | null;
  decision?: string | null;
  reason?: string | null;
  decided_by?: string | null;
  decided_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface MobileSnapshot {
  snapshot_version: number;
  projection_version: number;
  notification_cursor: number;
  generated_at: string;
  counts: {
    pending_approvals: number;
    active: number;
    waiting_user: number;
  };
  approvals: ApprovalRequest[];
  active_conversations: Conversation[];
  recent_conversations: Conversation[];
  stateless: true;
}

export interface MobileNotification {
  cursor: number;
  notification_id: string;
  kind: "approval.requested" | string;
  title: string;
  body: string;
  action_path: string;
  created_at: string;
}

export interface V2Event {
  event_id: string;
  task_id: string;
  sequence: number;
  type: string;
  actor: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface V2WorkflowRun {
  workflow_run_id: string;
  task_id: string;
  status: string;
  engine: string;
  config: Record<string, unknown>;
  attempt: number;
  created_at: string;
  updated_at: string;
}

export interface V2WorkflowStep {
  step_id: string;
  workflow_run_id: string;
  task_id: string;
  agent_task_id: string;
  role: string;
  status: string;
  adapter: string;
  order_index: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface V2Artifact {
  artifact_id: string;
  task_id: string;
  agent_task_id: string;
  name: string;
  kind: string;
  status: string;
  content: Record<string, unknown>;
  ref: string;
  created_at: string;
  updated_at: string;
}

export interface V2Evaluation {
  evaluation_id: string;
  task_id: string;
  agent_task_id: string;
  kind: string;
  status: string;
  details: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface V2Replay {
  replay_id: string;
  task_id: string;
  requested_by: string;
  status: string;
  snapshot: Record<string, unknown>;
  created_at: string;
}

export interface V2ExecutionUnit {
  unit_id: string;
  kind: string;
  status: string;
  labels: Record<string, unknown>;
  resources: Record<string, unknown>;
  adapters: string[];
  features: string[];
  heartbeat_at: string;
  created_at: string;
  updated_at: string;
}

export interface V2Channel {
  channel_id: string;
  platform: string;
  status: string;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface V2ChannelMessage {
  message_id: string;
  channel_id: string;
  platform: string;
  direction: string;
  status: string;
  external_message_id: string;
  sender: Record<string, unknown>;
  content: Record<string, unknown>;
  raw: Record<string, unknown>;
  task_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface V2Tenant {
  tenant_id: string;
  name: string;
  status: string;
  settings: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface V2TenantUser {
  tenant_id: string;
  user_id: string;
  email: string;
  roles: string[];
  status: string;
  created_at: string;
  updated_at: string;
}

export interface V2RbacPolicy {
  tenant_id: string;
  role: string;
  permissions: string[];
  created_at: string;
  updated_at: string;
}

export interface V2HaConfig {
  profile: string;
  database: Record<string, unknown>;
  queue: Record<string, unknown>;
  workers: Record<string, unknown>;
  workflow: V2WorkflowEngineStatus;
  backup: Record<string, unknown>;
  resource_fit: Record<string, unknown>;
}

export interface V2WorkflowEngineStatus {
  active_engine: string;
  engines: Array<Record<string, unknown>>;
}

export interface V2AdminOverview {
  generated_at: string;
  tasks: { total: number; by_status: Record<string, number> };
  agent_tasks: { total: number; by_status: Record<string, number> };
  execution_units: V2ExecutionUnit[];
  channels: V2Channel[];
  tenants: V2Tenant[];
  ha: V2HaConfig;
  reliability: Record<string, string>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new ApiError(
      (await response.text()) || response.statusText,
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

export const runtimeApi = {
  session: () => api<AuthSession>("auth/session"),
  login: (payload: { email: string; password: string }) =>
    api<AuthSession>("auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  logout: () =>
    api<{ authenticated: boolean }>("auth/logout", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  health: () => api<{ ok: boolean; version: string }>("health"),
  conversations: (includeArchived = false) =>
    api<{ conversations: Conversation[] }>(
      `conversations?include_archived=${includeArchived ? "true" : "false"}`,
    ),
  conversation: (conversationId: string) =>
    api<Conversation>(`conversations/${encodeURIComponent(conversationId)}`),
  conversationForTask: (taskId: string) =>
    api<Conversation>(`v2/tasks/${encodeURIComponent(taskId)}/conversation`),
  conversationMessages: (
    conversationId: string,
    after = 0,
    before?: number,
    limit = 200,
  ) => {
    const query = new URLSearchParams({ after: String(Math.max(0, after)) });
    if (before !== undefined) query.set("before", String(Math.max(0, before)));
    if (limit !== 200)
      query.set("limit", String(Math.max(1, Math.min(limit, 500))));
    return api<{
      messages: ConversationMessage[];
      projection_version: number;
    }>(`conversations/${encodeURIComponent(conversationId)}/messages?${query}`);
  },
  conversationCanvas: (conversationId: string) =>
    api<ConversationCanvas>(
      `conversations/${encodeURIComponent(conversationId)}/canvas`,
    ),
  conversationActivity: (conversationId: string) =>
    api<ConversationActivity>(
      `conversations/${encodeURIComponent(conversationId)}/activity`,
    ),
  createConversation: (payload: Record<string, unknown>) =>
    api<Conversation>("conversations", {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(payload),
    }),
  updateConversation: (
    conversationId: string,
    payload: {
      version: number;
      title?: string;
      pinned?: boolean;
      archived?: boolean;
    },
  ) =>
    api<Conversation>(`conversations/${encodeURIComponent(conversationId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  submitConversationMessage: (conversationId: string, message: string) =>
    api<ConversationMessageCommand>(
      `conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ message }),
      },
    ),
  stopConversation: (conversationId: string) =>
    api<Conversation>(
      `conversations/${encodeURIComponent(conversationId)}/stop`,
      {
        method: "POST",
        body: JSON.stringify({ reason: "stopped from client conversation" }),
      },
    ),
  approvals: (status = "pending") =>
    api<{ approvals: ApprovalRequest[] }>(
      `approvals?status=${encodeURIComponent(status)}`,
    ),
  approval: (approvalId: string) =>
    api<ApprovalRequest>(`approvals/${encodeURIComponent(approvalId)}`),
  decideApproval: (
    approvalId: string,
    payload: {
      action: "approve" | "reject" | "pause" | "revise";
      version: number;
      reason?: string;
      confirmed?: boolean;
    },
  ) =>
    api<ApprovalRequest>(
      `approvals/${encodeURIComponent(approvalId)}/decision`,
      {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(payload),
      },
    ),
  mobileSnapshot: () => api<MobileSnapshot>("mobile/snapshot"),
  mobileNotifications: (after = 0) =>
    api<{ notifications: MobileNotification[] }>(
      `mobile/notifications?after=${Math.max(0, after)}`,
    ),
  v2Capabilities: () => api<Record<string, unknown>>("v2/capabilities"),
  v2Tasks: () => api<{ tasks: V2Task[] }>("v2/tasks"),
  v2Task: (taskId: string) =>
    api<V2Task>(`v2/tasks/${encodeURIComponent(taskId)}`),
  v2TaskEvents: (taskId: string) =>
    api<{ events: V2Event[] }>(
      `v2/tasks/${encodeURIComponent(taskId)}/events.json`,
    ),
  v2TaskWebshellEvents: (taskId: string) =>
    api<{ events: DaemonEvent[] }>(
      `v2/tasks/${encodeURIComponent(taskId)}/webshell/events.json`,
    ),
  v2TaskWorkflow: (taskId: string) =>
    api<{ run: V2WorkflowRun | null; steps: V2WorkflowStep[] }>(
      `v2/tasks/${encodeURIComponent(taskId)}/workflow`,
    ),
  v2TaskArtifacts: (taskId: string) =>
    api<{ artifacts: V2Artifact[] }>(
      `v2/tasks/${encodeURIComponent(taskId)}/artifacts`,
    ),
  v2TaskEvaluations: (taskId: string) =>
    api<{ evaluations: V2Evaluation[] }>(
      `v2/tasks/${encodeURIComponent(taskId)}/evaluations`,
    ),
  v2TaskReplays: (taskId: string) =>
    api<{ replays: V2Replay[] }>(
      `v2/tasks/${encodeURIComponent(taskId)}/replays`,
    ),
  v2CreateTask: (payload: Record<string, unknown>) =>
    api<V2Task>("v2/tasks", {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(payload),
    }),
  v2SubmitMessage: (taskId: string, message: string) =>
    api<{ event: V2Event }>(`v2/tasks/${encodeURIComponent(taskId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  v2RetryTask: (taskId: string) =>
    api<V2Task>(`v2/tasks/${encodeURIComponent(taskId)}/retry`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  v2RetryFailedSteps: (taskId: string) =>
    api<V2Task>(`v2/tasks/${encodeURIComponent(taskId)}/retry-failed`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  v2AcceptPartialResult: (taskId: string) =>
    api<V2Task>(`v2/tasks/${encodeURIComponent(taskId)}/accept-partial`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  v2CancelTask: (taskId: string) =>
    api<V2Task>(`v2/tasks/${encodeURIComponent(taskId)}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason: "stopped from client conversation" }),
    }),
  v2ReplayTask: (taskId: string) =>
    api<V2Replay>(`v2/tasks/${encodeURIComponent(taskId)}/replay`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  v2AdminOverview: () => api<V2AdminOverview>("v2/admin/overview"),
  v2ExecutionUnits: () =>
    api<{ units: V2ExecutionUnit[] }>("v2/admin/execution-units"),
  v2Channels: () => api<{ channels: V2Channel[] }>("v2/admin/channels"),
  v2ChannelMessages: () =>
    api<{ messages: V2ChannelMessage[] }>("v2/admin/channel-messages"),
  v2Tenants: () => api<{ tenants: V2Tenant[] }>("v2/admin/tenants"),
  v2TenantUsers: (tenantId: string) =>
    api<{ users: V2TenantUser[] }>(
      `v2/admin/tenants/${encodeURIComponent(tenantId)}/users`,
    ),
  v2RbacPolicies: (tenantId: string) =>
    api<{ policies: V2RbacPolicy[] }>(
      `v2/admin/tenants/${encodeURIComponent(tenantId)}/rbac`,
    ),
  v2HaConfig: () => api<V2HaConfig>("v2/admin/ha"),
  v2WorkflowEngines: () =>
    api<V2WorkflowEngineStatus>("v2/admin/workflow-engines"),
  v2RegisterExecutionUnit: (payload: Record<string, unknown>) =>
    api<V2ExecutionUnit>("v2/admin/execution-units", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  v2DiscoverExecutionUnits: () =>
    api<{ units: V2ExecutionUnit[]; discovered: V2ExecutionUnit[] }>(
      "v2/admin/execution-units/discover",
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    ),
  v2ConfigureChannel: (platform: string, payload: Record<string, unknown>) =>
    api<V2Channel>(`v2/admin/channels/${encodeURIComponent(platform)}/config`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  v2SendChannelMessage: (platform: string, payload: Record<string, unknown>) =>
    api<V2ChannelMessage>(
      `v2/admin/channels/${encodeURIComponent(platform)}/send`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),
  v2UpsertTenant: (payload: Record<string, unknown>) =>
    api<V2Tenant>("v2/admin/tenants", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  v2UpsertTenantUser: (tenantId: string, payload: Record<string, unknown>) =>
    api<V2TenantUser>(
      `v2/admin/tenants/${encodeURIComponent(tenantId)}/users`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),
  v2UpsertRbacPolicy: (tenantId: string, payload: Record<string, unknown>) =>
    api<V2RbacPolicy>(`v2/admin/tenants/${encodeURIComponent(tenantId)}/rbac`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  capabilities: () => api<Capabilities>("capabilities"),
  metrics: () => api<Metrics>("metrics.json"),
  costStatus: () => api<CostStatus>("cost/status"),
  queue: () => api<QueueStatus>("queue"),
  workers: () => api<{ workers: WorkerInfo[] }>("workers"),
  createWorkerRegistration: (payload: Record<string, unknown>) =>
    api<WorkerRegistration>("workers/registrations", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  workerControl: (workerId: string) =>
    api<WorkerControl>(`workers/${encodeURIComponent(workerId)}/control`),
  drainWorker: (workerId: string, reason = "drain from console") =>
    api<{ worker: WorkerInfo; control: WorkerControl }>(
      `workers/${encodeURIComponent(workerId)}/drain`,
      {
        method: "POST",
        body: JSON.stringify({ reason }),
      },
    ),
  resumeWorker: (workerId: string) =>
    api<{ worker: WorkerInfo; control: WorkerControl }>(
      `workers/${encodeURIComponent(workerId)}/resume`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    ),
  retryWorkerRuns: (workerId: string) =>
    api<{
      worker_id: string;
      requeued_run_ids: string[];
      control: WorkerControl;
    }>(`workers/${encodeURIComponent(workerId)}/retry`, {
      method: "POST",
      body: JSON.stringify({ reason: "retry from console" }),
    }),
  executors: () =>
    api<{
      executor_registry: Record<string, unknown>;
      executors: ExecutorLease[];
    }>("executors"),
  runs: () => api<{ runs: RunState[] }>("runs"),
  tasks: () => api<{ tasks: TaskState[] }>("tasks"),
  task: (taskId: string) =>
    api<TaskState>(`tasks/${encodeURIComponent(taskId)}`),
  taskEvents: (taskId: string) =>
    api<{ events: TaskEvent[] }>(
      `tasks/${encodeURIComponent(taskId)}/events.json`,
    ),
  taskArtifacts: (taskId: string) =>
    api<{ artifacts: ArtifactInfo[] }>(
      `tasks/${encodeURIComponent(taskId)}/artifacts`,
    ),
  taskResult: (taskId: string) =>
    api<TaskResult>(`tasks/${encodeURIComponent(taskId)}/result`),
  createTask: (payload: TaskCreateRequest) =>
    api<TaskState>("tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  submitTaskMessage: (taskId: string, message: string) =>
    api<{ accepted: boolean; task_id: string; run_id?: string }>(
      `tasks/${encodeURIComponent(taskId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ message }),
      },
    ),
  cancelTask: (taskId: string) =>
    api<TaskState>(`tasks/${encodeURIComponent(taskId)}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason: "cancelled from workspace" }),
    }),
  run: (runId: string) => api<RunState>(`runs/${runId}`),
  runEvents: (runId: string) =>
    api<{ events: RuntimeEvent[] }>(`runs/${runId}/events.json`),
  sessionEvents: (sessionId: string) =>
    api<{ events: DaemonEvent[] }>(`session/${sessionId}/events.json`),
  runArtifacts: (runId: string) =>
    api<{ artifacts: ArtifactInfo[] }>(`runs/${runId}/artifacts`),
  runAudit: (runId: string) =>
    api<Record<string, unknown>>(`runs/${runId}/audit.json`),
  permissionNotifications: (runId: string) =>
    api<{ notifications: PermissionNotification[] }>(
      `runs/${runId}/permission-notifications`,
    ),
  createRun: (payload: Partial<RunSpec>) =>
    api<RunState>("runs", { method: "POST", body: JSON.stringify(payload) }),
  submitRunInput: (runId: string, prompt: string) =>
    api<RunInputResponse>(`runs/${runId}/input`, {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),
  submitSessionPrompt: (sessionId: string, prompt: string) =>
    api<{ accepted: boolean; session_id: string; run_id: string }>(
      `session/${sessionId}/prompt`,
      {
        method: "POST",
        body: JSON.stringify({ prompt }),
      },
    ),
  cancelRun: (runId: string) =>
    api<{ cancelled: boolean }>(`runs/${runId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason: "cancelled from console" }),
    }),
  resolvePermission: (
    runId: string,
    permissionId: string,
    payload: { decision: string; option_id?: string; reason?: string },
  ) =>
    api(`runs/${runId}/permissions/${permissionId}`, {
      method: "POST",
      body: JSON.stringify({ decided_by: "web-console", ...payload }),
    }),
  resolveSessionPermission: (
    sessionId: string,
    permissionId: string,
    payload: { decision: string; option_id?: string; reason?: string },
  ) =>
    api(`session/${sessionId}/permission/${permissionId}`, {
      method: "POST",
      body: JSON.stringify({ decided_by: "web-console", ...payload }),
    }),
  retryPermissionNotifications: (runId: string, permissionId: string) =>
    api<{ notifications: PermissionNotification[] }>(
      `runs/${runId}/permissions/${permissionId}/notifications/retry`,
      {
        method: "POST",
        body: JSON.stringify({ reason: "retry from web console" }),
      },
    ),
  missions: () => api<{ missions: MissionState[] }>("missions"),
  mission: (missionId: string) => api<MissionState>(`missions/${missionId}`),
  missionEvents: (missionId: string) =>
    api<{ events: MissionEvent[] }>(`missions/${missionId}/events.json`),
  missionArtifacts: (missionId: string) =>
    api<{ artifacts: ArtifactInfo[] }>(`missions/${missionId}/artifacts`),
  createMission: (payload: Record<string, unknown>) =>
    api<MissionState>("missions", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  cancelMission: (missionId: string, reason = "cancelled from console") =>
    api<MissionState>(`missions/${missionId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  overrideReviewGate: (
    missionId: string,
    payload: {
      decision: "approve" | "deny";
      reason: string;
      decided_by?: string;
    },
  ) =>
    api<MissionState>(`missions/${missionId}/review-gate/override`, {
      method: "POST",
      body: JSON.stringify({ decided_by: "web-console", ...payload }),
    }),
  profiles: () => api<{ profiles: AgentProfile[] }>("profiles"),
  profile: (profileId: string) => api<AgentProfile>(`profiles/${profileId}`),
  createProfile: (payload: Partial<AgentProfile>) =>
    api<AgentProfile>("profiles", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  accessPolicy: () => api<AccessPolicy>("access/policy"),
  accessProjects: () => api<{ projects: AccessProject[] }>("access/projects"),
  createAccessProject: (payload: Partial<AccessProject>) =>
    api<AccessProject>("access/projects", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  apiTokens: () => api<{ tokens: ApiToken[] }>("access/tokens"),
  createApiToken: (payload: Partial<ApiToken>) =>
    api<ApiToken>("access/tokens", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  revokeApiToken: (tokenId: string) =>
    api<ApiToken>(`access/tokens/${tokenId}/revoke`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  authUsers: () => api<{ users: AuthUser[] }>("auth/users"),
  createAuthUser: (payload: {
    email: string;
    password: string;
    display_name?: string;
    roles?: string[];
    email_verified?: boolean;
  }) =>
    api<AuthUser>("auth/users", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateAuthUserRoles: (email: string, roles: string[]) =>
    api<AuthUser>(`auth/users/${encodeURIComponent(email)}/roles`, {
      method: "POST",
      body: JSON.stringify({ roles }),
    }),
  updateAuthUserStatus: (email: string, status: string) =>
    api<AuthUser>(`auth/users/${encodeURIComponent(email)}/status`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }),
  resetAuthUserPassword: (email: string, password: string) =>
    api<AuthUser>(`auth/users/${encodeURIComponent(email)}/password`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  opsStatus: () => api<Record<string, unknown>>("ops/status"),
  drills: () => api<Record<string, unknown>>("ops/drills"),
  runDrills: () =>
    api<Record<string, unknown>>("ops/drills", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  backups: () => api<{ backups: BackupInfo[] }>("ops/backups"),
  createBackup: () =>
    api<{ backup: BackupInfo }>("ops/backups", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  p5Evaluations: () => api<{ components: P5Evaluation[] }>("p5/evaluations"),
};

export function artifactHref(runId: string, artifactName: string) {
  return `${API_BASE}runs/${runId}/artifacts/${encodeURIComponent(artifactName)}`;
}

export function auditHref(runId: string) {
  return `${API_BASE}runs/${runId}/audit.json`;
}

export function runEventStreamHref(runId: string) {
  return `${API_BASE}runs/${runId}/events`;
}

export function sessionEventStreamHref(sessionId: string) {
  return `${API_BASE}session/${sessionId}/events`;
}

export function conversationEventStreamHref(conversationId: string, after = 0) {
  return `${API_BASE}conversations/${encodeURIComponent(conversationId)}/events?after=${Math.max(0, after)}`;
}

export function mobileNotificationStreamHref(after = 0) {
  return `${API_BASE}mobile/notifications/events?after=${Math.max(0, after)}`;
}

export function backupHref(name: string) {
  return `${API_BASE}ops/backups/${encodeURIComponent(name)}`;
}

export function missionArtifactHref(missionId: string, artifactName: string) {
  return `${API_BASE}missions/${missionId}/artifacts/${encodeURIComponent(artifactName)}`;
}

export function extractPermissionRequest(
  event: RuntimeEvent,
): PermissionRequest | null {
  if (event.type !== "permission.requested") {
    return null;
  }
  const rawId = permissionEventId(event);
  if (!rawId) {
    return null;
  }
  const options =
    event.data.options ?? nestedValue(event.data.raw, "data", "options");
  return {
    permission_id: rawId,
    prompt: stringValue(
      event.data.prompt ??
        nestedValue(event.data.raw, "data", "prompt") ??
        nestedValue(event.data.raw, "data", "toolCall", "title"),
    ),
    tool: stringValue(
      event.data.tool ??
        nestedValue(event.data.raw, "data", "tool") ??
        nestedValue(event.data.raw, "data", "toolCall", "_meta", "toolName"),
    ),
    options: Array.isArray(options)
      ? options
          .filter(
            (option): option is Record<string, unknown> =>
              typeof option === "object",
          )
          .map((option) => ({
            id:
              stringValue(option.id) ||
              stringValue(option.option_id) ||
              stringValue(option.optionId) ||
              "approve",
            label: stringValue(option.label) || stringValue(option.name),
            description: stringValue(option.description),
          }))
      : undefined,
    raw: event.data,
  };
}

export function permissionEventId(event: RuntimeEvent) {
  return (
    stringValue(event.data.permission_id) ??
    stringValue(event.data.permissionId) ??
    stringValue(event.data.request_id) ??
    stringValue(event.data.requestId) ??
    stringValue(nestedValue(event.data.raw, "data", "permission_id")) ??
    stringValue(nestedValue(event.data.raw, "data", "permissionId")) ??
    stringValue(nestedValue(event.data.raw, "data", "request_id")) ??
    stringValue(nestedValue(event.data.raw, "data", "requestId")) ??
    stringValue(nestedValue(event.data.raw, "permission_id")) ??
    stringValue(nestedValue(event.data.raw, "requestId"))
  );
}

export function resolvedPermissionIds(events: RuntimeEvent[]) {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.type !== "permission.resolved") {
      continue;
    }
    const id = permissionEventId(event);
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

function getApiBase() {
  const path = window.location.pathname;
  if (path === "/agentflow" || path.startsWith("/agentflow/")) {
    return "/agentflow/";
  }
  if (path === "/cloud-agents" || path.startsWith("/cloud-agents/")) {
    return "/cloud-agents/";
  }
  return "/";
}

function nestedValue(value: unknown, ...keys: string[]) {
  let current = value;
  for (const key of keys) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
