import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onlineManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App, __testUtils, queryClient, router } from "./app";
import { __shellTestUtils } from "./components/shell";
import { __productTestUtils } from "./product";

const run = {
  run_id: "run_1",
  status: "running",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  event_count: 2,
  prompt_count: 1,
  spec: {
    adapter: "fake",
    prompt: "Inspect runtime",
  },
};

const mission = {
  mission_id: "mission_1",
  status: "running",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  event_count: 1,
  task_count: 2,
  completed_task_count: 1,
  failed_task_count: 0,
  spec: { goal: "Ship beta", strategy: "sequential", adapter: "fake" },
  tasks: [
    {
      task_id: "plan",
      title: "Plan mission",
      profile_id: "planner",
      status: "completed",
      run_id: "run_1",
      depends_on: [],
      result: { artifacts: [{ name: "plan.md" }] },
    },
    {
      task_id: "review",
      title: "Review mission",
      profile_id: "reviewer",
      status: "pending",
      run_id: null,
      depends_on: ["plan"],
    },
  ],
};

const missionEvents = [
  {
    id: "mevt_1",
    mission_id: "mission_1",
    sequence: 1,
    type: "task.created",
    created_at: new Date().toISOString(),
    data: { task_id: "plan" },
  },
  {
    id: "mevt_2",
    mission_id: "mission_1",
    sequence: 2,
    type: "mission.started",
    created_at: new Date().toISOString(),
    data: { strategy: "sequential" },
  },
];

const task = {
  task_id: "run_1",
  kind: "run",
  title: "Inspect runtime",
  goal: "Inspect runtime",
  status: "running",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  progress: { completed_steps: 0, total_steps: 1, percent: 50 },
  agent_summary: { adapter: "fake", active_agent: "Smoke Test Agent" },
  needs_attention: true,
  pending_permission_count: 1,
  source: { run_id: "run_1", mission_id: null },
  result_summary: "Inspecting live runner state.",
  links: { detail: "/tasks/run_1", source: "/runs/run_1" },
};

const taskEvents = [
  {
    id: "tevt_1",
    task_id: "run_1",
    sequence: 1,
    type: "task.accepted",
    title: "Task accepted",
    body: "Inspect runtime",
    status: "queued",
    created_at: new Date().toISOString(),
    source_event_type: "run.created",
    source: { kind: "run" },
  },
  {
    id: "tevt_2",
    task_id: "run_1",
    sequence: 2,
    type: "permission.required",
    title: "Action needs approval",
    body: "Allow shell command?",
    status: "blocked",
    created_at: new Date().toISOString(),
    source_event_type: "permission.requested",
    source: { kind: "run" },
  },
  {
    id: "tevt_3",
    task_id: "run_1",
    sequence: 3,
    type: "agent.message",
    title: "Agent update",
    body: "Inspecting live runner state.",
    status: "running",
    created_at: new Date().toISOString(),
    source_event_type: "message.delta",
    source: { kind: "run" },
  },
];

const v2Task = {
  task_id: "task_v2_1",
  tenant_id: "tenant_default",
  project_id: "project_default",
  created_by: "owner@example.com",
  title: "Ship the control plane",
  goal: "Ship the control plane",
  mode: "auto",
  status: "completed",
  priority: "normal",
  channel: "web",
  adapter: "fake",
  metadata: {
    dispatch: {
      adapter: "fake",
      execution_unit_id: "local-dev",
      reason: "auto selected fake on local-dev for web",
    },
  },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  progress: {
    completed_steps: 3,
    running_steps: 0,
    total_steps: 3,
    percent: 100,
  },
  plan: {
    plan_id: "plan_v2_1",
    task_id: "task_v2_1",
    version: 1,
    status: "active",
    strategy: "orchestrator-workers",
    graph: {
      strategy: "orchestrator-workers",
      nodes: [
        { id: "brain", title: "Plan the work", depends_on: [] },
        { id: "builder", title: "Execute the work", depends_on: ["brain"] },
        {
          id: "reviewer",
          title: "Review and package",
          depends_on: ["builder"],
        },
      ],
    },
    artifact_contract: { required: ["final_summary"] },
    agent_tasks: [
      {
        agent_task_id: "at_brain",
        task_id: "task_v2_1",
        plan_id: "plan_v2_1",
        role: "brain",
        title: "Plan the work",
        goal: "Clarify scope, risks, and execution order",
        status: "completed",
        adapter: "fake",
        order_index: 0,
        depends_on: [],
        artifact_contract: {
          evaluation: "must produce non-empty result summary",
        },
        result: { final_summary: "Plan complete." },
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        agent_task_id: "at_builder",
        task_id: "task_v2_1",
        plan_id: "plan_v2_1",
        role: "builder",
        title: "Execute the work",
        goal: "Produce the requested deliverable",
        status: "completed",
        adapter: "fake",
        order_index: 1,
        depends_on: ["brain"],
        artifact_contract: {
          evaluation: "must produce non-empty result summary",
        },
        result: { final_summary: "Build complete." },
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        agent_task_id: "at_reviewer",
        task_id: "task_v2_1",
        plan_id: "plan_v2_1",
        role: "reviewer",
        title: "Review and package",
        goal: "Evaluate output and prepare summary",
        status: "completed",
        adapter: "fake",
        order_index: 2,
        depends_on: ["builder"],
        artifact_contract: {
          evaluation: "must produce non-empty result summary",
        },
        result: { final_summary: "Review complete." },
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  result: {
    summary: "Plan complete. Build complete. Review complete.",
    artifacts: [
      { name: "final_summary", kind: "summary", status: "available" },
    ],
    evaluation: { status: "passed", checks: ["contract"] },
  },
};

const v2FallbackTask = {
  ...v2Task,
  task_id: "task_v2_legacy",
  title: "Legacy recovered task",
  goal: "Continue a recovered task",
  status: "queued",
  channel: "email",
  adapter: "custom-cli",
  metadata: {},
  progress: {
    completed_steps: 0,
    running_steps: 0,
    total_steps: 1,
    percent: 0,
  },
  plan: null,
  result: null,
};

const v2RunningTask = {
  ...v2Task,
  task_id: "task_v2_running",
  title: "Audit authentication flow",
  goal: "Audit the authentication flow with multiple agents",
  status: "running",
  progress: {
    completed_steps: 0,
    running_steps: 1,
    total_steps: 3,
    percent: 0,
  },
  plan: {
    ...v2Task.plan,
    task_id: "task_v2_running",
    agent_tasks: v2Task.plan.agent_tasks.map((agent, index) => ({
      ...agent,
      task_id: "task_v2_running",
      status: index === 0 ? "running" : "queued",
    })),
  },
  result: null,
};

const v2FailedTask = {
  ...v2FallbackTask,
  task_id: "task_v2_failed",
  title: "Review deployment failure",
  goal: "Diagnose the failed deployment",
  status: "failed",
};

const v2CancelledTask = {
  ...v2FallbackTask,
  task_id: "task_v2_cancelled",
  title: "Stopped dependency upgrade",
  goal: "Upgrade workspace dependencies",
  status: "cancelled",
};

const v2PausedTask = {
  ...v2FallbackTask,
  task_id: "task_v2_paused",
  title: "Paused migration review",
  goal: "Review the migration plan before continuing",
  status: "paused",
};

function conversationFromTask(
  taskValue: {
    task_id: string;
    tenant_id: string;
    project_id: string;
    created_by: string;
    title: string;
    goal: string;
    status: string;
    created_at: string;
    updated_at: string;
  },
  status = taskValue.status === "running" || taskValue.status === "queued"
    ? "active"
    : taskValue.status === "completed"
      ? "completed"
      : taskValue.status === "failed"
        ? "failed"
        : "idle",
) {
  const suffix = taskValue.task_id.replace("task_", "");
  const execution = {
    execution_id: `exec_${suffix}`,
    conversation_id: `conv_${suffix}`,
    task_id: taskValue.task_id,
    sequence: 1,
    status: taskValue.status,
    trigger_message: taskValue.goal,
    created_at: taskValue.created_at,
    updated_at: taskValue.updated_at,
  };
  return {
    conversation_id: `conv_${suffix}`,
    tenant_id: taskValue.tenant_id,
    project_id: taskValue.project_id,
    created_by: taskValue.created_by,
    title: taskValue.title,
    status,
    unread_count: 0,
    pending_approval_count: 0,
    pinned_at: null,
    archived_at: null,
    version: 1,
    projection_version: 1,
    last_meaningful_activity_at: taskValue.updated_at,
    created_at: taskValue.created_at,
    updated_at: taskValue.updated_at,
    executions: [execution],
    latest_execution: execution,
  };
}

const completedConversation = conversationFromTask(v2Task);
const runningConversation = conversationFromTask(v2RunningTask);
const fallbackConversation = conversationFromTask(v2FallbackTask);
const failedConversation = conversationFromTask(v2FailedTask);
const cancelledConversation = conversationFromTask(v2CancelledTask);
const pausedConversation = conversationFromTask(v2PausedTask);

const conversationMessages = {
  projection_version: 1,
  messages: [
    {
      message_id: "msg_created",
      conversation_id: completedConversation.conversation_id,
      execution_id: completedConversation.latest_execution.execution_id,
      cursor: 1_000_001,
      role: "user",
      kind: "text",
      content: [{ type: "text", text: v2Task.goal }],
      created_at: v2Task.created_at,
      revision: 1,
    },
    {
      message_id: "msg_plan",
      conversation_id: completedConversation.conversation_id,
      execution_id: completedConversation.latest_execution.execution_id,
      cursor: 1_000_002,
      role: "agent",
      kind: "plan",
      content: [
        { type: "text", text: "已生成执行计划，将由 3 个 Agent 协作完成。" },
        {
          type: "entity_ref",
          entity_type: "plan",
          entity_id: "plan_v2_1",
          label: "查看计划与 Agent",
        },
      ],
      created_at: v2Task.updated_at,
      revision: 1,
    },
    {
      message_id: "msg_result",
      conversation_id: completedConversation.conversation_id,
      execution_id: completedConversation.latest_execution.execution_id,
      cursor: 1_000_003,
      role: "agent",
      kind: "result",
      content: [
        { type: "text", text: v2Task.result.summary },
        {
          type: "entity_ref",
          entity_type: "artifacts",
          entity_id: v2Task.task_id,
          label: "查看产物与验收结果",
        },
      ],
      created_at: v2Task.updated_at,
      revision: 1,
    },
  ],
};

const v2Events = [
  {
    event_id: "v2evt_1",
    task_id: "task_v2_1",
    sequence: 1,
    type: "task.created",
    actor: "system",
    payload: { title: "Ship the control plane" },
    created_at: new Date().toISOString(),
  },
  {
    event_id: "v2evt_2",
    task_id: "task_v2_1",
    sequence: 2,
    type: "plan.created",
    actor: "brain",
    payload: { strategy: "orchestrator-workers" },
    created_at: new Date().toISOString(),
  },
];

const v2Workflow = {
  run: {
    workflow_run_id: "wfr_1",
    task_id: "task_v2_1",
    status: "completed",
    engine: "local-sqlite-dag",
    config: { strategy: "orchestrator-workers" },
    attempt: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  steps: v2Task.plan.agent_tasks.map((agent) => ({
    step_id: `wfs_${agent.role}`,
    workflow_run_id: "wfr_1",
    task_id: "task_v2_1",
    agent_task_id: agent.agent_task_id,
    role: agent.role,
    status: agent.status,
    adapter: agent.adapter,
    order_index: agent.order_index,
    input: { goal: agent.goal },
    output: { artifact_id: `artifact_${agent.role}` },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  })),
};

const v2Artifacts = {
  artifacts: [
    ...v2Task.plan.agent_tasks.map((agent) => ({
      artifact_id: `artifact_${agent.role}`,
      task_id: "task_v2_1",
      agent_task_id: agent.agent_task_id,
      name: "final_summary",
      kind: "summary",
      status: "available",
      content: { final_summary: agent.result.final_summary },
      ref: `v2/task_v2_1/artifact_${agent.role}.json`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })),
    {
      artifact_id: "artifact_patch",
      task_id: "task_v2_1",
      agent_task_id: "agent_builder",
      name: "client.patch",
      kind: "patch",
      status: "available",
      content: { diff: "--- a/client.ts\n+++ b/client.ts" },
      ref: "v2/task_v2_1/artifact_patch.json",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
};

const v2Evaluations = {
  evaluations: v2Task.plan.agent_tasks.map((agent) => ({
    evaluation_id: `eval_${agent.role}`,
    task_id: "task_v2_1",
    agent_task_id: agent.agent_task_id,
    kind: "contract",
    status: "passed",
    details: { checks: ["non_empty_summary"] },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })),
};

const v2Replay = {
  replay_id: "replay_1",
  task_id: "task_v2_1",
  requested_by: "owner@example.com",
  status: "created",
  snapshot: { task: v2Task, workflow: v2Workflow },
  created_at: new Date().toISOString(),
};

const conversationCanvas = {
  conversation_id: completedConversation.conversation_id,
  projection_version: 1,
  executions: [
    {
      ...completedConversation.latest_execution,
      plan: v2Task.plan,
      workflow: v2Workflow,
      artifacts: v2Artifacts.artifacts,
      evaluations: v2Evaluations.evaluations,
      replays: [v2Replay],
      progress: v2Task.progress,
      result: v2Task.result,
    },
  ],
  latest_execution: {
    ...completedConversation.latest_execution,
    plan: v2Task.plan,
    workflow: v2Workflow,
    artifacts: v2Artifacts.artifacts,
    evaluations: v2Evaluations.evaluations,
    replays: [v2Replay],
    progress: v2Task.progress,
    result: v2Task.result,
  },
};

const conversationActivity = {
  conversation_id: completedConversation.conversation_id,
  status: "completed",
  latest_execution: completedConversation.latest_execution,
  active_agent: null,
  progress: v2Task.progress,
  pending_approval_count: 0,
  updated_at: v2Task.updated_at,
};

const runningConversationMessages = {
  projection_version: 1,
  messages: [
    {
      ...conversationMessages.messages[0],
      message_id: "msg_running_created",
      conversation_id: runningConversation.conversation_id,
      execution_id: runningConversation.latest_execution.execution_id,
      content: [{ type: "text", text: v2RunningTask.goal }],
    },
    {
      ...conversationMessages.messages[1],
      message_id: "msg_running_plan",
      conversation_id: runningConversation.conversation_id,
      execution_id: runningConversation.latest_execution.execution_id,
      content: [
        { type: "text", text: "已生成运行中的审计计划。" },
        {
          type: "entity_ref",
          entity_type: "plan",
          entity_id: "plan_v2_running",
          label: "查看计划与 Agent",
        },
      ],
    },
  ],
};

const runningConversationCanvas = {
  conversation_id: runningConversation.conversation_id,
  projection_version: 1,
  executions: [
    {
      ...runningConversation.latest_execution,
      plan: v2RunningTask.plan,
      workflow: { run: null, steps: [] },
      artifacts: [],
      evaluations: [],
      replays: [],
      progress: v2RunningTask.progress,
      result: null,
    },
  ],
  latest_execution: {
    ...runningConversation.latest_execution,
    plan: v2RunningTask.plan,
    workflow: { run: null, steps: [] },
    artifacts: [],
    evaluations: [],
    replays: [],
    progress: v2RunningTask.progress,
    result: null,
  },
};

const runningConversationActivity = {
  conversation_id: runningConversation.conversation_id,
  status: "active",
  latest_execution: runningConversation.latest_execution,
  active_agent: v2RunningTask.plan.agent_tasks[0],
  progress: v2RunningTask.progress,
  pending_approval_count: 0,
  updated_at: v2RunningTask.updated_at,
};

const fallbackConversationMessages = {
  projection_version: 1,
  messages: [],
};

const fallbackConversationCanvas = {
  conversation_id: fallbackConversation.conversation_id,
  projection_version: 1,
  executions: [
    {
      ...fallbackConversation.latest_execution,
      plan: null,
      workflow: { run: null, steps: [] },
      artifacts: [],
      evaluations: [],
      replays: [],
      progress: v2FallbackTask.progress,
      result: null,
    },
  ],
  latest_execution: {
    ...fallbackConversation.latest_execution,
    plan: null,
    workflow: { run: null, steps: [] },
    artifacts: [],
    evaluations: [],
    replays: [],
    progress: v2FallbackTask.progress,
    result: null,
  },
};

const fallbackConversationActivity = {
  conversation_id: fallbackConversation.conversation_id,
  status: fallbackConversation.status,
  latest_execution: fallbackConversation.latest_execution,
  active_agent: null,
  progress: v2FallbackTask.progress,
  pending_approval_count: 0,
  updated_at: v2FallbackTask.updated_at,
};

const waitingConversation = {
  ...completedConversation,
  conversation_id: "conv_waiting_review",
  title: "Approve production rollout",
  status: "waiting_user",
  pending_approval_count: 1,
  version: 3,
  executions: [
    completedConversation.latest_execution,
    {
      ...completedConversation.latest_execution,
      execution_id: "exec_waiting_review",
      conversation_id: "conv_waiting_review",
      task_id: "task_waiting_review",
      sequence: 2,
      status: "waiting_user",
      trigger_message: "Deploy the reviewed release",
    },
  ],
  latest_execution: {
    ...completedConversation.latest_execution,
    execution_id: "exec_waiting_review",
    conversation_id: "conv_waiting_review",
    task_id: "task_waiting_review",
    sequence: 2,
    status: "waiting_user",
    trigger_message: "Deploy the reviewed release",
  },
};

const waitingConversationMessages = {
  projection_version: 1,
  messages: [
    conversationMessages.messages[0],
    {
      message_id: "msg_waiting_user",
      conversation_id: waitingConversation.conversation_id,
      execution_id: waitingConversation.latest_execution.execution_id,
      cursor: 2_000_001,
      role: "user",
      kind: "text",
      content: [{ type: "text", text: "Deploy the reviewed release" }],
      created_at: v2Task.updated_at,
      revision: 1,
    },
    {
      message_id: "msg_waiting_approval",
      conversation_id: waitingConversation.conversation_id,
      execution_id: waitingConversation.latest_execution.execution_id,
      cursor: 2_000_002,
      role: "system",
      kind: "approval",
      content: [
        { type: "text", text: "生产发布需要你的批准。" },
        {
          type: "entity_ref",
          entity_type: "approval",
          entity_id: "approval_1",
          label: "查看审批",
        },
        {
          type: "attachment",
          name: "deployment-diff.patch",
          href: "/artifacts/deployment-diff.patch",
        },
      ],
      created_at: v2Task.updated_at,
      revision: 1,
    },
  ],
};

const waitingConversationCanvas = {
  conversation_id: waitingConversation.conversation_id,
  projection_version: 1,
  executions: [
    conversationCanvas.executions[0],
    {
      ...waitingConversation.latest_execution,
      plan: null,
      workflow: { run: null, steps: [] },
      artifacts: [],
      evaluations: [],
      replays: [],
      progress: {
        completed_steps: 0,
        running_steps: 0,
        total_steps: 1,
        percent: 0,
      },
      result: null,
    },
  ],
  latest_execution: {
    ...waitingConversation.latest_execution,
    plan: null,
    workflow: { run: null, steps: [] },
    artifacts: [],
    evaluations: [],
    replays: [],
    progress: {
      completed_steps: 0,
      running_steps: 0,
      total_steps: 1,
      percent: 0,
    },
    result: null,
  },
};

const waitingConversationActivity = {
  conversation_id: waitingConversation.conversation_id,
  status: "waiting_user",
  latest_execution: waitingConversation.latest_execution,
  active_agent: null,
  progress: null,
  pending_approval_count: 1,
  updated_at: v2Task.updated_at,
};

const pendingApproval = {
  approval_id: "approval_1",
  conversation_id: waitingConversation.conversation_id,
  execution_id: waitingConversation.latest_execution.execution_id,
  task_id: waitingConversation.latest_execution.task_id,
  requested_by: "system",
  intent: "将已审核版本部署到生产环境",
  evidence: [
    {
      type: "diff",
      label: "部署变更摘要",
      summary: "修改 3 个配置文件并更新生产镜像标签。",
      ref: "deployment-diff.patch",
    },
  ],
  impact: {
    level: "high",
    summary: "会更新生产环境服务，错误发布可能造成短暂不可用。",
    affected_resources: ["production/api", "production/web"],
    reversible: true,
  },
  allowed_actions: ["approve", "reject", "pause", "revise"],
  scope: { environment: "production" },
  status: "pending",
  version: 1,
  expires_at: null,
  decision: null,
  reason: null,
  decided_by: null,
  decided_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const resolvedApproval = {
  ...pendingApproval,
  approval_id: "approval_resolved",
  status: "rejected",
  version: 2,
  decision: "reject",
  reason: "缺少回滚演练证据",
  decided_by: "owner@example.com",
  decided_at: new Date().toISOString(),
};

const lowRiskApproval = {
  ...pendingApproval,
  approval_id: "approval_low",
  intent: "在测试环境刷新缓存",
  evidence: [],
  impact: {
    level: "low",
    summary: "仅影响测试缓存。",
    affected_resources: [],
    reversible: false,
  },
  allowed_actions: ["approve"],
};

const v2Overview = {
  generated_at: new Date().toISOString(),
  tasks: { total: 1, by_status: { completed: 1 } },
  agent_tasks: { total: 3, by_status: { completed: 3 } },
  execution_units: [
    {
      unit_id: "local-dev",
      kind: "local-workspace",
      status: "active",
      labels: { region: "local" },
      resources: { cpu: 2 },
      adapters: ["fake", "qwen"],
      features: ["workspace", "artifacts", "events"],
      heartbeat_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      unit_id: "ecs-test",
      kind: "ecs",
      status: "active",
      labels: {},
      resources: { cpu: 2 },
      adapters: ["qwen"],
      features: ["remote-worker", "artifacts"],
      heartbeat_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      unit_id: "ecs-offline",
      kind: "ecs",
      status: "offline",
      labels: { region: "offline" },
      resources: { cpu: 2 },
      adapters: ["qwen"],
      features: ["remote-worker"],
      heartbeat_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  channels: [
    {
      channel_id: "channel_web",
      platform: "web",
      status: "configured",
      config: { signed_callbacks: false },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      channel_id: "channel_feishu",
      platform: "feishu",
      status: "reserved",
      config: { signed_callbacks: true },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  tenants: [
    {
      tenant_id: "tenant_default",
      name: "Default Tenant",
      status: "active",
      settings: { plan: "local" },
      created_by: "system",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  ha: {
    profile: "local-2c2g",
    database: { driver: "sqlite", configured: false },
    queue: { driver: "sqlite-lease", configured: false },
    workers: { horizontal_scale: false, concurrency: 1 },
    workflow: {
      active_engine: "local-sqlite-dag",
      engines: [
        { engine: "local-sqlite-dag", status: "available" },
        { engine: "temporal", status: "available" },
      ],
    },
    backup: { enabled: true, target: "local-artifacts" },
    resource_fit: { two_c_two_g: true },
  },
  reliability: {
    idempotency: "enabled",
    event_source: "sqlite:v2_events",
    runner: "local background worker",
    production_runner: "Temporal",
  },
};

const events = [
  {
    id: "evt_0",
    run_id: "run_1",
    sequence: 1,
    type: "run.created",
    created_at: new Date().toISOString(),
    data: { spec: run.spec },
  },
  {
    id: "evt_1",
    run_id: "run_1",
    sequence: 2,
    type: "permission.requested",
    created_at: new Date().toISOString(),
    data: {
      permission_id: "perm_1",
      prompt: "Allow shell command?",
      tool: "shell",
      options: [
        { id: "proceed_once", label: "Approve" },
        { id: "cancel", label: "Reject" },
      ],
    },
  },
  {
    id: "evt_2",
    run_id: "run_1",
    sequence: 3,
    type: "step.started",
    created_at: new Date().toISOString(),
    data: { prompt_number: 1 },
  },
  {
    id: "evt_3",
    run_id: "run_1",
    sequence: 4,
    type: "message.delta",
    created_at: new Date().toISOString(),
    data: { prompt_number: 1, text: "Inspecting live runner state." },
  },
];

const daemonEvents = [
  {
    id: 1,
    v: 1,
    type: "session_update",
    data: {
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "Inspect runtime" },
      },
    },
    _meta: {
      serverTimestamp: Date.now(),
      runtimeRunId: "run_1",
      runtimeSequence: 1,
      runtimeEventType: "input.accepted",
    },
  },
  {
    id: 2,
    v: 1,
    type: "permission_request",
    data: {
      requestId: "perm_1",
      prompt: "Allow shell command?",
      tool: "shell",
      options: [
        { id: "proceed_once", label: "Approve" },
        { id: "cancel", label: "Reject" },
      ],
      context: { command: "uname -a", cwd: "/workspace" },
    },
    _meta: {
      serverTimestamp: Date.now(),
      runtimeRunId: "run_1",
      runtimeSequence: 2,
      runtimeEventType: "permission.requested",
    },
  },
  {
    id: 3,
    v: 1,
    type: "session_update",
    data: {
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "Inspecting live runner state.",
        },
      },
    },
    _meta: {
      serverTimestamp: Date.now(),
      runtimeRunId: "run_1",
      runtimeSequence: 3,
      runtimeEventType: "message.delta",
    },
  },
  {
    id: 4,
    v: 1,
    type: "session_update",
    data: {
      update: {
        sessionUpdate: "tool_call_update",
        toolCall: {
          id: "tool_1",
          name: "shell",
          status: "completed",
          input: "uname -a",
          output: "Linux test-host",
        },
      },
    },
    _meta: {
      serverTimestamp: Date.now(),
      runtimeRunId: "run_1",
      runtimeSequence: 4,
      runtimeEventType: "tool.completed",
    },
  },
] as const;

let authSessionAuthenticated = true;
let failV2TaskCreate = false;
let failConversationMessage = false;
let emptyApprovalQueues = false;

const fixtures: Record<string, unknown> = {
  "auth/session": {
    authenticated: true,
    principal: { id: "operator", display_name: "operator", roles: ["owner"] },
  },
  health: { ok: true, version: "0.1-test" },
  capabilities: {
    mode: "saeu-runtime",
    features: ["metrics", "backup", "executor_registry", "cost_budget"],
    adapters: {
      fake: { name: "Fake", status: "available" },
      qwen: { name: "Qwen", status: "available" },
    },
    queue: { counts: {}, jobs: [], workers: [] },
    executor_registry: {
      config: {
        strategy: "per_run_process",
        enabled: true,
        container_image: "qwen-code:latest",
        container_network: "bridge",
      },
      counts: { running: 1 },
    },
    profiles: [],
  },
  "metrics.json": {
    generated_at: new Date().toISOString(),
    runs: { total: 1, by_status: { running: 1 } },
    missions: { total: 1, by_status: { running: 1 } },
    queue: {
      counts: { queued: 0, running: 1 },
      worker_count: 1,
      active_workers: 1,
      stale_workers: 0,
    },
    permissions: { pending: 1, stalled: 0 },
    latency_seconds: { count: 0, avg: null, p95: null },
  },
  executors: {
    executor_registry: {
      config: {
        strategy: "per_run_process",
        enabled: true,
        container_image: "qwen-code:latest",
        container_network: "bridge",
      },
      counts: { running: 1 },
    },
    executors: [
      {
        executor_id: "exec_1",
        run_id: "run_1",
        adapter: "qwen",
        strategy: "per_run_process",
        status: "running",
        base_url: "http://127.0.0.1:4210",
        workspace: "/tmp/workspace/run_1",
        port: 4210,
        pid: 1234,
        started_at: new Date().toISOString(),
        heartbeat_at: new Date().toISOString(),
        released_at: null,
        exit_code: null,
        last_error: null,
        metadata: {},
      },
    ],
  },
  "cost/status": {
    generated_at: new Date().toISOString(),
    status: "ok",
    config: {
      monthly_budget_usd: 10,
      per_run_budget_usd: 1,
      estimated_cost_per_run_usd: 0.05,
    },
    month: "2026-07",
    monthly_estimated_cost_usd: 0.1,
    monthly_budget_usd: 10,
    warning_threshold_usd: 8,
    runs: [{ run_id: "run_1", estimated_cost_usd: 0.1 }],
  },
  workers: {
    workers: [
      {
        worker_id: "hk-2c2g-a",
        status: "active",
        capacity: 1,
        active_count: 1,
        heartbeat_at: new Date().toISOString(),
        lease_ttl_seconds: 60,
        metadata: {
          kind: "remote",
          labels: { region: "hk" },
          resources: { cpus: 2, memory_gb: 2 },
          capabilities: { adapters: ["fake", "qwen"] },
        },
      },
      {
        worker_id: "local",
        status: "draining",
        capacity: 1,
        active_count: 0,
        heartbeat_at: new Date().toISOString(),
        lease_ttl_seconds: 60,
        metadata: { kind: "local" },
      },
    ],
  },
  tasks: { tasks: [task] },
  "tasks/run_1": task,
  "tasks/run_1/events.json": { events: taskEvents },
  "tasks/run_1/artifacts": {
    artifacts: [
      {
        name: "final-report.md",
        size_bytes: 42,
        updated_at: new Date().toISOString(),
      },
    ],
  },
  "tasks/run_1/result": {
    task_id: "run_1",
    status: "running",
    summary: "Inspecting live runner state.",
    artifacts: [
      {
        name: "final-report.md",
        size_bytes: 42,
        updated_at: new Date().toISOString(),
      },
    ],
    completed: false,
    generated_at: new Date().toISOString(),
  },
  "v2/tasks": {
    tasks: [
      v2Task,
      v2RunningTask,
      v2FallbackTask,
      v2FailedTask,
      v2CancelledTask,
      v2PausedTask,
    ],
  },
  "conversations?include_archived=true": {
    conversations: [
      completedConversation,
      runningConversation,
      fallbackConversation,
      failedConversation,
      cancelledConversation,
      pausedConversation,
      waitingConversation,
    ],
  },
  "approvals?status=pending": { approvals: [pendingApproval] },
  "approvals?status=all": { approvals: [pendingApproval, resolvedApproval] },
  "approvals/approval_1": pendingApproval,
  "approvals/approval_resolved": resolvedApproval,
  "approvals/approval_low": lowRiskApproval,
  "mobile/snapshot": {
    snapshot_version: 1,
    projection_version: 3,
    notification_cursor: 1,
    generated_at: new Date().toISOString(),
    counts: { pending_approvals: 1, active: 2, waiting_user: 1 },
    approvals: [pendingApproval],
    active_conversations: [runningConversation, waitingConversation],
    recent_conversations: [completedConversation],
    stateless: true,
  },
  [`conversations/${completedConversation.conversation_id}`]:
    completedConversation,
  [`conversations/${completedConversation.conversation_id}/messages?after=0`]:
    conversationMessages,
  [`conversations/${completedConversation.conversation_id}/canvas`]:
    conversationCanvas,
  [`conversations/${completedConversation.conversation_id}/activity`]:
    conversationActivity,
  [`conversations/${runningConversation.conversation_id}`]: runningConversation,
  [`conversations/${runningConversation.conversation_id}/messages?after=0`]:
    runningConversationMessages,
  [`conversations/${runningConversation.conversation_id}/canvas`]:
    runningConversationCanvas,
  [`conversations/${runningConversation.conversation_id}/activity`]:
    runningConversationActivity,
  [`conversations/${fallbackConversation.conversation_id}`]:
    fallbackConversation,
  [`conversations/${fallbackConversation.conversation_id}/messages?after=0`]:
    fallbackConversationMessages,
  [`conversations/${fallbackConversation.conversation_id}/canvas`]:
    fallbackConversationCanvas,
  [`conversations/${fallbackConversation.conversation_id}/activity`]:
    fallbackConversationActivity,
  [`conversations/${failedConversation.conversation_id}`]: failedConversation,
  [`conversations/${failedConversation.conversation_id}/messages?after=0`]:
    conversationMessages,
  [`conversations/${failedConversation.conversation_id}/canvas`]:
    conversationCanvas,
  [`conversations/${failedConversation.conversation_id}/activity`]: {
    ...conversationActivity,
    conversation_id: failedConversation.conversation_id,
    status: "failed",
    latest_execution: failedConversation.latest_execution,
  },
  [`conversations/${waitingConversation.conversation_id}`]: waitingConversation,
  [`conversations/${waitingConversation.conversation_id}/messages?after=0`]:
    waitingConversationMessages,
  [`conversations/${waitingConversation.conversation_id}/canvas`]:
    waitingConversationCanvas,
  [`conversations/${waitingConversation.conversation_id}/activity`]:
    waitingConversationActivity,
  "v2/tasks/task_v2_1": v2Task,
  "v2/tasks/task_v2_1/conversation": completedConversation,
  "v2/tasks/task_v2_1/events.json": { events: v2Events },
  "v2/tasks/task_v2_1/webshell/events.json": { events: daemonEvents },
  "v2/tasks/task_v2_1/workflow": v2Workflow,
  "v2/tasks/task_v2_1/artifacts": v2Artifacts,
  "v2/tasks/task_v2_1/evaluations": v2Evaluations,
  "v2/tasks/task_v2_1/replays": { replays: [v2Replay] },
  "v2/tasks/task_v2_legacy": v2FallbackTask,
  "v2/tasks/task_v2_legacy/conversation": fallbackConversation,
  "v2/tasks/task_v2_legacy/events.json": { events: [] },
  "v2/tasks/task_v2_legacy/webshell/events.json": { events: [] },
  "v2/tasks/task_v2_legacy/workflow": { run: null, steps: [] },
  "v2/tasks/task_v2_legacy/artifacts": { artifacts: [] },
  "v2/tasks/task_v2_legacy/evaluations": { evaluations: [] },
  "v2/tasks/task_v2_legacy/replays": { replays: [] },
  "v2/tasks/task_v2_running": v2RunningTask,
  "v2/tasks/task_v2_running/conversation": runningConversation,
  "v2/tasks/task_v2_running/events.json": { events: [] },
  "v2/tasks/task_v2_running/webshell/events.json": { events: [] },
  "v2/tasks/task_v2_running/workflow": { run: null, steps: [] },
  "v2/tasks/task_v2_running/artifacts": { artifacts: [] },
  "v2/tasks/task_v2_running/evaluations": { evaluations: [] },
  "v2/tasks/task_v2_running/replays": { replays: [] },
  "v2/admin/overview": v2Overview,
  "v2/admin/execution-units": { units: v2Overview.execution_units },
  "v2/admin/channels": { channels: v2Overview.channels },
  "v2/admin/channel-messages": {
    messages: [
      {
        message_id: "chmsg_1",
        channel_id: "channel_feishu",
        platform: "feishu",
        direction: "inbound",
        status: "accepted",
        external_message_id: "msg_1",
        sender: { open_id: "ou_1" },
        content: { text: "Ship control plane" },
        raw: {},
        task_id: "task_v2_1",
        error: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  },
  "v2/admin/tenants": { tenants: v2Overview.tenants },
  "v2/admin/tenants/tenant_default/users": {
    users: [
      {
        tenant_id: "tenant_default",
        user_id: "owner@example.com",
        email: "owner@example.com",
        roles: ["owner"],
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  },
  "v2/admin/tenants/tenant_default/rbac": {
    policies: [
      {
        tenant_id: "tenant_default",
        role: "owner",
        permissions: ["*"],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  },
  "v2/admin/ha": v2Overview.ha,
  "v2/admin/workflow-engines": v2Overview.ha.workflow,
  "v2/admin/execution-units/discover": {
    units: v2Overview.execution_units,
    discovered: [],
  },
  "v2/admin/channels/feishu/config": v2Overview.channels[1],
  "v2/admin/channels/feishu/send": {
    message_id: "chmsg_2",
    channel_id: "channel_feishu",
    platform: "feishu",
    direction: "outbound",
    status: "queued",
    external_message_id: "",
    sender: { system: "agentflow" },
    content: { msg_type: "text", content: { text: "AgentFlow channel test" } },
    raw: {},
    task_id: null,
    error: "webhook_url is not configured",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  "v2/admin/tenants/tenant_acme": v2Overview.tenants[0],
  runs: { runs: [run] },
  "runs/run_1": run,
  "runs/run_1/events.json": { events },
  "session/run_1/events.json": { events: daemonEvents },
  "runs/run_1/permission-notifications": {
    notifications: [
      {
        notification_id: "notif_log",
        run_id: "run_1",
        permission_id: "perm_1",
        channel: "log",
        target: "operator",
        status: "sent",
        attempts: 1,
        message: "Permission requested",
        action_url: "/#/runs/run_1",
        delivery_ref: "event-log",
        error: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        sent_at: new Date().toISOString(),
        metadata: {},
      },
      {
        notification_id: "notif_webhook",
        run_id: "run_1",
        permission_id: "perm_1",
        channel: "webhook",
        target: "operator",
        status: "failed",
        attempts: 1,
        message: "Permission requested",
        action_url: "/#/runs/run_1",
        delivery_ref: null,
        error: "webhook unreachable",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        sent_at: null,
        metadata: {},
      },
    ],
  },
  "runs/run_1/artifacts": {
    artifacts: [
      {
        name: "final-report.md",
        size_bytes: 42,
        updated_at: new Date().toISOString(),
      },
    ],
  },
  missions: { missions: [mission] },
  "missions/mission_1": mission,
  "missions/mission_1/events.json": { events: missionEvents },
  "missions/mission_1/artifacts": {
    artifacts: [
      {
        name: "final_report.md",
        size_bytes: 88,
        updated_at: new Date().toISOString(),
      },
    ],
  },
  profiles: {
    profiles: [
      {
        id: "planner",
        display_name: "Planner",
        description: "Plan work",
        version: 1,
        source: "system",
        runtime: { preferred_adapter: "qwen" },
        tools: { allow: ["read_file"] },
        approval: { mode: "ask" },
        limits: {},
        workspace: {},
        artifacts: {},
      },
    ],
  },
  "ops/status": {
    database: { exists: true },
    security: { docker_socket: false },
  },
  "ops/drills": {
    status: "pass",
    checks: [
      {
        id: "runtime-db",
        status: "pass",
        summary: "runtime.db is present",
        details: {},
      },
    ],
  },
  "ops/backups": {
    backups: [
      {
        name: "cloud-agents-backup-test.tar.gz",
        size_bytes: 128,
        created_at: new Date().toISOString(),
      },
    ],
  },
  "p5/evaluations": {
    components: [
      {
        id: "acp-streamable-http",
        status: "implemented",
        mode: "json-rpc",
        decision: "keep",
      },
    ],
  },
  "access/policy": {
    mode: "single-tenant-rbac-foundation",
    current_principal: {
      id: "operator",
      display_name: "operator",
      roles: ["owner"],
    },
    roles: [
      {
        id: "owner",
        description: "Can administer runtime",
        permissions: ["runs:*", "missions:*", "profiles:*"],
      },
    ],
    scopes: ["runs:*", "missions:*", "profiles:*"],
    projects: [
      {
        project_id: "default",
        display_name: "Default",
        description: "Default project",
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {},
      },
    ],
    tokens: [
      {
        token_id: "token_1",
        name: "operator-token",
        principal_id: "operator",
        project_id: "default",
        scopes: ["runs:*"],
        status: "active",
        token_prefix: "cat_test",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        revoked_at: null,
        last_used_at: null,
        metadata: {},
      },
    ],
    audit: { auth_boundary: "runtime session cookie plus bearer" },
  },
  "access/projects": {
    projects: [
      {
        project_id: "default",
        display_name: "Default",
        description: "Default project",
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {},
      },
    ],
  },
  "access/tokens": {
    tokens: [
      {
        token_id: "token_1",
        name: "operator-token",
        principal_id: "operator",
        project_id: "default",
        scopes: ["runs:*"],
        status: "active",
        token_prefix: "cat_test",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        revoked_at: null,
        last_used_at: null,
        metadata: {},
      },
    ],
  },
  "auth/users": {
    users: [
      {
        email: "owner@example.com",
        display_name: "Owner",
        roles: ["owner"],
        status: "active",
        email_verified_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_login_at: null,
        metadata: {},
      },
      {
        email: "auditor@example.com",
        display_name: "",
        roles: ["auditor"],
        status: "active",
        email_verified_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_login_at: new Date().toISOString(),
        metadata: {},
      },
    ],
  },
};

describe("AgentFlow console", () => {
  beforeEach(async () => {
    onlineManager.setOnline(true);
    queryClient.clear();
    authSessionAuthenticated = true;
    failV2TaskCreate = false;
    failConversationMessage = false;
    emptyApprovalQueues = false;
    localStorage.clear();
    window.location.hash = "";
    document.documentElement.classList.remove("dark");
    vi.stubGlobal("fetch", vi.fn(fetchMock));
    await act(async () => {
      await router.navigate({ to: "/" });
    });
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the client workspace and keeps the admin control plane reachable", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "今天想完成什么？" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("搜索会话")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "新建会话" })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "管理后台" }));
    expect(
      await screen.findByRole("heading", { name: "Admin Control Plane" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Reliability Spine")).toBeInTheDocument();

    await user.click(screen.getByLabelText("切换语言"));
    expect(
      await screen.findByRole("heading", { name: "Admin Control Plane" }),
    ).toBeInTheDocument();
    expect(localStorage.getItem("agentflow-locale")).toBe("en");
  });

  it("filters, collapses, and personalizes the conversation sidebar", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "今天想完成什么？" });
    await user.click(screen.getByRole("button", { name: "已完成" }));
    expect(screen.getByText("返回全部会话")).toBeInTheDocument();
    expect(screen.getByText("Ship the control plane")).toBeInTheDocument();
    expect(screen.queryByText("Legacy recovered task")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "返回全部会话" }));
    const search = screen.getByLabelText("搜索会话");
    await user.type(search, "missing conversation");
    expect(screen.getByText("没有匹配的会话")).toBeInTheDocument();
    await user.clear(search);
    expect(screen.getByText("Legacy recovered task")).toBeInTheDocument();

    await user.click(screen.getByLabelText("收起会话导航"));
    await user.click(screen.getByLabelText("展开会话导航"));
    await user.click(screen.getByLabelText("切换主题"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    await user.click(screen.getByLabelText("退出登录"));
    expect(
      await screen.findByRole("heading", { name: "登录" }),
    ).toBeInTheDocument();
  });

  it("shows login page and signs in with session credentials", async () => {
    const user = userEvent.setup();
    authSessionAuthenticated = false;
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "登录" }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("邮箱"), "owner@example.com");
    await user.type(screen.getByLabelText("密码"), "wrong");
    await user.click(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByText("邮箱或密码无效。")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("密码"));
    await user.type(screen.getByLabelText("密码"), "secret");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(
      await screen.findByRole("heading", { name: "今天想完成什么？" }),
    ).toBeInTheDocument();
  });

  it("creates and inspects a task from the client workspace", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "今天想完成什么？" }),
    ).toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText("向 AgentFlow 描述你的任务……"),
      "Ship the control plane",
    );
    await user.click(screen.getByText("执行设置", { exact: false }));
    expect(
      screen.getByRole("option", { name: "ecs-test" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /ecs-offline/ }),
    ).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("执行方式"), "multi-agent");
    await user.selectOptions(screen.getByLabelText("来源渠道"), "feishu");
    await user.selectOptions(screen.getByLabelText("Agent CLI"), "codex");
    await user.selectOptions(screen.getByLabelText("执行单元"), "local-dev");
    await user.click(screen.getByRole("button", { name: "发送任务" }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/conversations",
        expect.objectContaining({
          method: "POST",
          body: expect.stringMatching(
            /Ship the control plane.*multi-agent.*feishu.*codex.*local-dev/s,
          ),
        }),
      ),
    );
    expect(
      await screen.findByRole("heading", { name: "Ship the control plane" }),
    ).toBeInTheDocument();
    expect(screen.getByText("执行计划")).toBeInTheDocument();
    expect(screen.getByLabelText("会话消息")).toBeInTheDocument();
    expect(screen.getByText("3 个工作方向")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Agent" }));
    expect(screen.getByText("Agent 协作")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "在 Chat 中定位相关简报" }),
    ).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "变更" }));
    expect(screen.getByText("client.patch")).toBeInTheDocument();
    expect(screen.getByText(/\+\+\+ b\/client.ts/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "文件" }));
    expect(screen.getByText("文件与引用")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "流程" }));
    expect(screen.getByText("工作流程")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "产物" }));
    expect(screen.getByText("任务产物")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "验收" }));
    expect(screen.getByText("验收结果")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "活动" }));
    expect(screen.getByText("执行历史")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "保存回放" }));
    await user.click(screen.getByRole("button", { name: "重新执行" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/v2/tasks/task_v2_1/replay",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/v2/tasks/task_v2_1/retry",
      expect.objectContaining({ method: "POST" }),
    );

    await user.type(screen.getByLabelText("继续对话"), "Include audit notes");
    await user.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        `/conversations/${completedConversation.conversation_id}/messages`,
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("Include audit notes"),
        }),
      ),
    );
  });

  it("does not submit an empty task", async () => {
    render(<App />);

    fireEvent.submit(await screen.findByRole("form", { name: "New Task" }));

    expect(fetch).not.toHaveBeenCalledWith(
      "/conversations",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("preserves a follow-up when the relay cannot accept it", async () => {
    const user = userEvent.setup();
    failConversationMessage = true;
    await act(async () => {
      await router.navigate({
        to: "/conversations/$conversationId",
        params: { conversationId: completedConversation.conversation_id },
      });
    });
    render(<App />);
    await screen.findByRole("heading", { name: "Ship the control plane" });

    await user.type(screen.getByLabelText("继续对话"), "Keep this draft");
    await user.click(screen.getByRole("button", { name: "发送消息" }));
    expect(
      await screen.findByText("消息未发送。内容仍保留在输入框中，请重试。"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("继续对话")).toHaveValue("Keep this draft");
  });

  it("explains when a new conversation cannot be started", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "今天想完成什么？" });
    failV2TaskCreate = true;

    await user.type(
      screen.getByPlaceholderText("向 AgentFlow 描述你的任务……"),
      "Start a task while disconnected",
    );
    await user.click(screen.getByRole("button", { name: "发送任务" }));

    expect(
      await screen.findByText("任务暂时无法启动，请检查连接后重试。"),
    ).toBeInTheDocument();
  });

  it("explains that a missing legacy task link has expired", async () => {
    const user = userEvent.setup();
    await act(async () => {
      await router.navigate({
        to: "/tasks/$taskId",
        params: { taskId: "task_missing" },
      });
    });
    render(<App />);

    expect(
      await screen.findByText("这个旧任务链接已失效", undefined, {
        timeout: 4000,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "任务可能已被删除或迁移记录不存在。你可以返回会话列表继续工作。",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "返回会话列表" }));
    expect(await screen.findByText("今天想完成什么？")).toBeInTheDocument();
  });

  it("keeps retry available when legacy task migration is temporarily unavailable", async () => {
    await act(async () => {
      await router.navigate({
        to: "/tasks/$taskId",
        params: { taskId: "task_unavailable" },
      });
    });
    render(<App />);

    expect(
      await screen.findByText("暂时无法加载这个会话", undefined, {
        timeout: 4000,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("请检查网络连接后重试。远端任务可能仍在运行。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新同步" })).toBeEnabled();
  });

  it("keeps durable conversation recovery controls available after a projection error", async () => {
    const user = userEvent.setup();
    await act(async () => {
      await router.navigate({
        to: "/conversations/$conversationId",
        params: { conversationId: "conv_missing" },
      });
    });
    render(<App />);

    expect(
      await screen.findByText(
        "请检查网络连接后重试。远端执行不会因此中断。",
        undefined,
        {
          timeout: 4000,
        },
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("会话正在准备中")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "活动" }));
    expect(screen.getByText("暂无执行记录")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重新同步" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/conversations/conv_missing",
        expect.any(Object),
      ),
    );
  });

  it("shows an active projected conversation and stops it safely", async () => {
    const user = userEvent.setup();
    await act(async () => {
      await router.navigate({
        to: "/tasks/$taskId",
        params: { taskId: "task_v2_legacy" },
      });
    });
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Legacy recovered task" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(
      `/conversations/${fallbackConversation.conversation_id}`,
    );
    expect(screen.getByText("尚未生成执行计划")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "流程" }));
    expect(screen.getByText("暂无工作流步骤")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "产物" }));
    expect(screen.getByText("暂无产物")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "验收" }));
    expect(screen.getByText("暂无验收结果")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "活动" }));
    await user.click(screen.getByText("展开原始事件"));
    expect(screen.getByText("暂无活动记录")).toBeInTheDocument();
    expect(screen.getByText("暂无回放快照")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "停止" }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        `/conversations/${fallbackConversation.conversation_id}/stop`,
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("summarizes the currently active agent without exposing raw logs", async () => {
    await act(async () => {
      await router.navigate({
        to: "/tasks/$taskId",
        params: { taskId: "task_v2_running" },
      });
    });
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Audit authentication flow" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Agent 正在后台继续工作，你可以安全切换到其他会话。"),
    ).toBeInTheDocument();
    expect(screen.getByText("brain · Plan the work")).toBeInTheDocument();
  });

  it("streams a conversation, survives offline mode, and stops the active execution", async () => {
    const user = userEvent.setup();
    class FakeEventSource {
      static instance: FakeEventSource;
      onopen: (() => void) | null = null;
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onerror: (() => void) | null = null;
      close = vi.fn();
      url: string;

      constructor(url: string) {
        this.url = url;
        FakeEventSource.instance = this;
      }
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    await act(async () => {
      await router.navigate({
        to: "/conversations/$conversationId",
        params: { conversationId: runningConversation.conversation_id },
      });
    });
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Audit authentication flow" }),
    ).toBeInTheDocument();
    expect(FakeEventSource.instance.url).toContain(
      `/conversations/${runningConversation.conversation_id}/events`,
    );
    const canvasNavigation = screen.getByRole("navigation", {
      name: "Canvas 视图",
    });
    expect(within(canvasNavigation).getAllByRole("button")).toHaveLength(8);
    await user.click(screen.getByRole("button", { name: "查看计划与 Agent" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/conversations/${runningConversation.conversation_id}/canvas/plan/plan_v2_running`,
      ),
    );
    expect(screen.getByText("执行计划")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "变更" }));
    expect(screen.getByText("本次执行没有结构化文件变更")).toBeInTheDocument();
    await act(async () => FakeEventSource.instance.onopen?.());
    expect(screen.getByText("实时")).toBeInTheDocument();
    await act(async () => {
      FakeEventSource.instance.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify(runningConversationMessages.messages[1]),
        }),
      );
      FakeEventSource.instance.onmessage?.(
        new MessageEvent("message", { data: "malformed" }),
      );
      FakeEventSource.instance.onerror?.();
    });
    expect(screen.getByText("同步中")).toBeInTheDocument();

    await act(async () => window.dispatchEvent(new Event("offline")));
    expect(
      screen.getByText("当前离线。会话仍保留在远端，恢复连接后会自动同步。"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("继续对话")).toBeDisabled();
    await act(async () => window.dispatchEvent(new Event("online")));
    expect(screen.getByLabelText("继续对话")).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "活动" }));
    expect(screen.getByText("当前微状态")).toBeInTheDocument();
    expect(screen.getByText("第 1 次执行")).toBeInTheDocument();
    await user.click(screen.getByText("展开原始事件"));
    expect(screen.getByText("暂无活动记录")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "停止" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        `/conversations/${runningConversation.conversation_id}/stop`,
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("renders approval context and switches between conversation executions", async () => {
    const user = userEvent.setup();
    await act(async () => {
      await router.navigate({
        to: "/conversations/$conversationId/canvas/$canvasTab",
        params: {
          conversationId: waitingConversation.conversation_id,
          canvasTab: "artifacts",
        },
      });
    });
    render(<App />);

    expect(
      await screen.findByRole("heading", {
        name: "Approve production rollout",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("生产发布需要你的批准。")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "deployment-diff.patch" }),
    ).toHaveAttribute("href", "/artifacts/deployment-diff.patch");
    expect(screen.getByText("暂无产物")).toBeInTheDocument();
    expect(screen.getByLabelText("选择执行")).toHaveValue(
      "exec_waiting_review",
    );

    await user.selectOptions(screen.getByLabelText("选择执行"), "exec_v2_1");
    expect(await screen.findAllByText("final_summary")).not.toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "查看审批" }));
    expect(await screen.findByText("Agent 想做什么")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/approvals/approval_1");
  });

  it("reviews a high-risk approval with evidence, reasons, and explicit confirmation", async () => {
    const user = userEvent.setup();
    await act(async () => {
      await router.navigate({
        to: "/approvals/$approvalId",
        params: { approvalId: pendingApproval.approval_id },
      });
    });
    render(<App />);

    expect(await screen.findByText("Agent 想做什么")).toBeInTheDocument();
    expect(screen.getAllByText(pendingApproval.intent).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("部署变更摘要")).toBeInTheDocument();
    expect(screen.getByText("影响面评估")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "要求修改" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "拒绝并停止" })).toBeDisabled();

    await user.type(screen.getByLabelText("决策原因"), "先补充回滚演练");
    await user.click(screen.getByRole("button", { name: "要求修改" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        `/approvals/${pendingApproval.approval_id}/decision`,
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"action":"revise"'),
        }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "暂停" }));
    await user.click(screen.getByRole("button", { name: "拒绝并停止" }));

    await user.click(screen.getByRole("button", { name: "批准并继续" }));
    expect(
      screen.getByRole("dialog", { name: "再次确认高风险操作" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回检查" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批准并继续" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "批准并继续" }));
    await user.click(
      screen.getByRole("button", { name: "我已核对，批准执行" }),
    );
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        `/approvals/${pendingApproval.approval_id}/decision`,
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"confirmed":true'),
        }),
      ),
    );
  });

  it("prevents approval decisions while the client is offline", async () => {
    await act(async () => {
      await router.navigate({
        to: "/approvals/$approvalId",
        params: { approvalId: pendingApproval.approval_id },
      });
    });
    render(<App />);
    await screen.findByText("Agent 想做什么");

    await act(async () => window.dispatchEvent(new Event("offline")));
    expect(screen.getByText(/恢复连接前不能提交决策/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批准并继续" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "暂停" })).toBeDisabled();
  });

  it("shows resolved approval history without decision controls", async () => {
    await act(async () => {
      await router.navigate({
        to: "/approvals/$approvalId",
        params: { approvalId: resolvedApproval.approval_id },
      });
    });
    render(<App />);

    expect(await screen.findByText("最近已处理（1）")).toBeInTheDocument();
    expect(
      screen.getByText("此请求已拒绝：缺少回滚演练证据"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "批准并继续" }),
    ).not.toBeInTheDocument();
  });

  it("approves a low-risk request directly and explains missing evidence", async () => {
    const user = userEvent.setup();
    await act(async () => {
      await router.navigate({
        to: "/approvals/$approvalId",
        params: { approvalId: lowRiskApproval.approval_id },
      });
    });
    render(<App />);

    expect(
      await screen.findByText("此请求没有附加证据，不建议直接批准。"),
    ).toBeInTheDocument();
    expect(screen.getByText("低风险")).toBeInTheDocument();
    expect(screen.getByText("不可自动回滚")).toBeInTheDocument();
    expect(screen.queryByText(/影响资源：/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "要求修改" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "批准并继续" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        `/approvals/${lowRiskApproval.approval_id}/decision`,
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"action":"approve"'),
        }),
      ),
    );
  });

  it("shows a calm empty approval inbox", async () => {
    emptyApprovalQueues = true;
    await act(async () => {
      await router.navigate({ to: "/approvals" });
    });
    render(<App />);

    expect(await screen.findByText("已清空")).toBeInTheDocument();
    expect(await screen.findByText("目前没有待处理事项")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "无需处理" }),
    ).toBeInTheDocument();
  });

  it("opens the first pending decision from the approval inbox", async () => {
    await act(async () => {
      await router.navigate({ to: "/approvals" });
    });
    render(<App />);

    expect(await screen.findByText("Agent 想做什么")).toBeInTheDocument();
    expect(screen.getAllByText(pendingApproval.intent).length).toBeGreaterThan(
      0,
    );
  });

  it("renders a stateless mobile triage snapshot", async () => {
    await act(async () => {
      await router.navigate({ to: "/mobile" });
    });
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "移动决策台" }),
    ).toBeInTheDocument();
    expect(screen.getByText("只同步状态快照与审批请求")).toBeInTheDocument();
    expect(screen.getByText("等待我处理")).toBeInTheDocument();
    expect(await screen.findByText(pendingApproval.intent)).toBeInTheDocument();
    expect(screen.getByText("远端正在执行")).toBeInTheDocument();
    expect(screen.getAllByText("最近完成").length).toBeGreaterThan(1);
    expect(screen.getByText("Agent 正在后台推进")).toBeInTheDocument();
    expect(screen.getAllByText("等待你的决定").length).toBeGreaterThan(0);
  });

  it("shows empty mobile snapshot states without inventing progress", async () => {
    emptyApprovalQueues = true;
    await act(async () => {
      await router.navigate({ to: "/mobile" });
    });
    render(<App />);

    expect(await screen.findByText("没有待处理决策")).toBeInTheDocument();
    expect(screen.getByText("没有正在执行的任务")).toBeInTheDocument();
    expect(screen.getByText("invalid-date")).toBeInTheDocument();
  });

  it("labels a cached mobile snapshot as stale while offline", async () => {
    await act(async () => {
      await router.navigate({ to: "/mobile" });
    });
    render(<App />);
    await screen.findByText(pendingApproval.intent);

    await act(async () => window.dispatchEvent(new Event("offline")));
    expect(screen.getByText(/正在显示最近同步的状态快照/)).toBeInTheDocument();
  });

  it("receives a redacted mobile relay event and enables system notifications", async () => {
    const user = userEvent.setup();
    class FakeEventSource {
      static instance: FakeEventSource;
      listeners = new Map<string, EventListener>();
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onerror: (() => void) | null = null;
      onopen: (() => void) | null = null;
      close = vi.fn();
      constructor(public url: string) {
        FakeEventSource.instance = this;
      }
      addEventListener(type: string, listener: EventListener) {
        this.listeners.set(type, listener);
      }
    }
    class FakeNotification {
      static permission: NotificationPermission = "default";
      static created: FakeNotification[] = [];
      static requestPermission = vi.fn(async () => {
        FakeNotification.permission = "granted";
        return "granted" as NotificationPermission;
      });
      onclick: (() => void) | null = null;
      close = vi.fn();
      constructor(
        public title: string,
        public options?: NotificationOptions,
      ) {
        FakeNotification.created.push(this);
      }
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("Notification", FakeNotification);
    await act(async () => {
      await router.navigate({ to: "/mobile" });
    });
    render(<App />);

    await screen.findByRole("heading", { name: "移动决策台" });
    await user.click(screen.getByRole("button", { name: "开启审批通知" }));
    expect(FakeNotification.requestPermission).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(FakeEventSource.instance.url).toContain(
        "mobile/notifications/events?after=1",
      ),
    );
    await act(async () => {
      FakeEventSource.instance.listeners.get("mobile.notification")?.(
        new MessageEvent("mobile.notification", {
          data: JSON.stringify({
            cursor: 2,
            notification_id: "mobile_2",
            kind: "approval.requested",
            title: "高风险操作等待确认",
            body: "请打开移动决策台核对意图、证据和影响。",
            action_path: "/approvals/approval_1",
            created_at: new Date().toISOString(),
          }),
        }),
      );
      FakeEventSource.instance.listeners.get("mobile.notification")?.(
        new MessageEvent("mobile.notification", { data: "malformed" }),
      );
    });
    expect(FakeNotification.created[0]?.title).toBe("高风险操作等待确认");
    expect(FakeNotification.created[0]?.options?.body).not.toContain("部署");
    vi.spyOn(window, "focus").mockImplementation(() => undefined);
    await act(async () => FakeNotification.created[0]?.onclick?.());
    expect(FakeNotification.created[0]?.close).toHaveBeenCalledOnce();
    expect(window.location.hash).toBe("#/approvals/approval_1");
  });

  it("explains when browser notification permission is denied", async () => {
    class DeniedNotification {
      static permission: NotificationPermission = "denied";
      static requestPermission = vi.fn();
    }
    vi.stubGlobal("Notification", DeniedNotification);
    await act(async () => {
      await router.navigate({ to: "/mobile" });
    });
    render(<App />);

    expect(
      await screen.findByText(/系统通知已被浏览器关闭/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "开启审批通知" }),
    ).not.toBeInTheDocument();
  });

  it("offers focused recovery choices for a partially failed execution", async () => {
    const user = userEvent.setup();
    await act(async () => {
      await router.navigate({
        to: "/conversations/$conversationId",
        params: { conversationId: failedConversation.conversation_id },
      });
    });
    render(<App />);

    expect(await screen.findByText("这次执行没有全部完成")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "仅重试失败步骤" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/v2/tasks/task_v2_failed/retry-failed",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "接受已有结果" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/v2/tasks/task_v2_failed/accept-partial",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "修改目标后继续" }));
    expect(screen.getByLabelText("继续对话")).toHaveFocus();
  });

  it("validates cached mobile snapshots and decision labels defensively", () => {
    localStorage.removeItem("agentflow-mobile-snapshot-v1");
    expect(__productTestUtils.readCachedMobileSnapshot()).toBeNull();
    localStorage.setItem("agentflow-mobile-snapshot-v1", "not-json");
    expect(__productTestUtils.readCachedMobileSnapshot()).toBeNull();
    localStorage.setItem(
      "agentflow-mobile-snapshot-v1",
      JSON.stringify({ snapshot_version: 2, stateless: true }),
    );
    expect(__productTestUtils.readCachedMobileSnapshot()).toBeNull();
    localStorage.setItem(
      "agentflow-mobile-snapshot-v1",
      JSON.stringify({ snapshot_version: 1, stateless: false }),
    );
    expect(__productTestUtils.readCachedMobileSnapshot()).toBeNull();
    localStorage.setItem(
      "agentflow-mobile-snapshot-v1",
      JSON.stringify({
        snapshot_version: 1,
        projection_version: 1,
        notification_cursor: 0,
        generated_at: new Date().toISOString(),
        counts: { pending_approvals: 0, active: 0, waiting_user: 0 },
        approvals: [],
        active_conversations: [],
        recent_conversations: [],
        stateless: true,
      }),
    );
    expect(__productTestUtils.readCachedMobileSnapshot()).toMatchObject({
      snapshot_version: 1,
      stateless: true,
    });

    expect(__productTestUtils.impactLabel("high")).toBe("高风险");
    expect(__productTestUtils.impactLabel("medium")).toBe("中风险");
    expect(__productTestUtils.impactLabel("low")).toBe("低风险");
    expect(__productTestUtils.approvalStatusLabel("approved")).toBe("批准");
    expect(__productTestUtils.approvalStatusLabel("pending")).toBe("等待处理");
    expect(__productTestUtils.approvalStatusLabel("rejected")).toBe("拒绝");
    expect(__productTestUtils.approvalStatusLabel("expired")).toBe("过期");
    expect(__productTestUtils.approvalStatusLabel("cancelled")).toBe("取消");
    expect(__productTestUtils.approvalStatusLabel("paused")).toBe("暂停");
    expect(__productTestUtils.approvalStatusLabel("revision_requested")).toBe(
      "退回修改",
    );
    expect(__productTestUtils.formatDateTime("invalid-date")).toBe(
      "invalid-date",
    );
    expect(
      __productTestUtils.formatDateTime("2026-07-17T08:00:00.000Z"),
    ).not.toBe("2026-07-17T08:00:00.000Z");

    for (const tab of [
      "plan",
      "agents",
      "diff",
      "files",
      "artifacts",
      "workflow",
      "evaluation",
      "activity",
    ]) {
      expect(__productTestUtils.normalizeCanvasTab(tab)).toBe(tab);
    }
    expect(__productTestUtils.normalizeCanvasTab("unknown")).toBe("plan");
    expect(__productTestUtils.normalizeCanvasTab()).toBe("plan");

    const artifact = (content: Record<string, unknown>) =>
      ({ content }) as Parameters<
        typeof __productTestUtils.artifactStructuredText
      >[0];
    expect(
      __productTestUtils.artifactStructuredText(
        artifact({ diff: "diff body", patch: "ignored" }),
      ),
    ).toBe("diff body");
    expect(
      __productTestUtils.artifactStructuredText(
        artifact({ patch: "patch body" }),
      ),
    ).toBe("patch body");
    expect(
      __productTestUtils.artifactStructuredText(
        artifact({ text: "text body" }),
      ),
    ).toBe("text body");
    expect(
      __productTestUtils.artifactStructuredText(
        artifact({ content: "content body" }),
      ),
    ).toBe("content body");
    expect(
      __productTestUtils.artifactStructuredText(artifact({ structured: true })),
    ).toContain('"structured": true');

    expect(__productTestUtils.modeLabel("multi-agent")).toBe("Multi-agent");
    expect(__productTestUtils.modeLabel("custom-mode")).toBe("custom-mode");
    expect(__productTestUtils.adapterLabel("qwen")).toBe("qwen-code");
    expect(__productTestUtils.adapterLabel("custom-adapter")).toBe(
      "custom-adapter",
    );
    const channels = [
      { platform: "mobile", status: "configured" },
    ] as Parameters<typeof __productTestUtils.channelStatus>[0];
    expect(__productTestUtils.channelStatus(channels, "mobile")).toBe(
      "configured",
    );
    expect(__productTestUtils.channelStatus([], "web")).toBe("configured");
    expect(__productTestUtils.channelStatus([], "slack")).toBe("reserved");
    expect(__productTestUtils.tenantSlug(" Example Team ")).toBe(
      "tenant_example_team",
    );
    expect(__productTestUtils.tenantSlug("___")).toBe("tenant_new");
  });

  it("pins and archives conversations with versioned updates", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "今天想完成什么？" });
    const conversationTitle = await screen.findByText("Ship the control plane");
    const pin = conversationTitle
      .closest(".group")
      ?.querySelector<HTMLButtonElement>('button[aria-label="置顶会话"]');
    expect(pin).toBeTruthy();
    await user.click(pin!);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/^\/conversations\/conv_/),
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"pinned":true'),
        }),
      ),
    );
    const archive = (await screen.findByText("Ship the control plane"))
      .closest(".group")
      ?.querySelector<HTMLButtonElement>('button[aria-label="归档会话"]');
    expect(archive).toBeTruthy();
    await user.click(archive!);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/^\/conversations\/conv_/),
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"archived":true'),
      }),
    );
    await user.click(screen.getByRole("button", { name: "已归档" }));
    expect(screen.getByText("返回全部会话")).toBeInTheDocument();
  });

  it("shows the admin control plane overview", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("link", { name: /Admin|管理后台/ }),
    );

    expect(
      await screen.findByRole("heading", { name: "Admin Control Plane" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Reliability Spine")).toBeInTheDocument();
    expect(screen.getByText("local-dev")).toBeInTheDocument();
    expect(screen.getByText("Feishu")).toBeInTheDocument();
    expect(screen.getByText("sqlite:v2_events")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Discover" }));
    await user.type(
      screen.getByLabelText("Webhook URL"),
      "https://bot.example",
    );
    await user.type(screen.getByLabelText("Callback token"), "token");
    await user.click(screen.getByRole("button", { name: "Configure" }));
    await user.clear(screen.getByLabelText("Outbound test"));
    await user.type(screen.getByLabelText("Outbound test"), "hello channel");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await user.type(screen.getByLabelText("Tenant name"), "Acme");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await user.type(
      screen.getByLabelText("Default tenant user"),
      "new@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));
  });

  it("creates a run from the Runs page", async () => {
    const user = userEvent.setup();
    render(<App />);
    await switchToEnglish(user);
    await user.click(
      await screen.findByRole("link", { name: /Admin|管理后台/ }),
    );
    await user.click(await screen.findByRole("link", { name: "Runs" }));

    expect(
      await screen.findByRole("heading", { name: "Runs" }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText("Adapter")).toHaveValue("fake");
    expect(
      screen.getByText(
        "fake is a low-cost smoke test. Run it first when validating a new deployment.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /refresh/i }));
    await user.selectOptions(screen.getByLabelText("Adapter"), "qwen");
    expect(
      screen.getByText(
        "qwen consumes more CPU/memory and may require approvals. Use it after fake passes.",
      ),
    ).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Adapter"), "fake");
    await user.clear(await screen.findByLabelText("Prompt"));
    await user.type(screen.getByLabelText("Prompt"), "Run a smoke validation");
    await user.type(screen.getByLabelText("Repo"), "/tmp/repo");
    await user.type(screen.getByLabelText("Workspace"), "/tmp/workspace");
    await user.clear(screen.getByLabelText("Timeout seconds"));
    await user.type(screen.getByLabelText("Timeout seconds"), "900");
    await user.click(screen.getByRole("button", { name: /start/i }));
    expect(screen.getByRole("button", { name: /submitting/i })).toBeDisabled();

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/runs",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("Run a smoke validation"),
        }),
      ),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/admin/runs/run_created"),
    );
    expect(
      await screen.findByRole("heading", { name: "Run Detail" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Agent Chat")).toBeInTheDocument();
  });

  it("resolves a run permission and exposes artifact downloads", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => "blob:runner-report");
    const revokeObjectURL = vi.fn();
    const click = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      const element = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        tagName,
      ) as HTMLAnchorElement;
      if (tagName === "a") {
        element.click = click;
      }
      return element;
    });
    await act(async () => {
      await router.navigate({
        to: "/admin/runs/$runId",
        params: { runId: "run_1" },
      });
    });
    render(<App />);
    await switchToEnglish(user);

    expect(await screen.findByText("Permission Requests")).toBeInTheDocument();
    expect(await screen.findByText("log:sent")).toBeInTheDocument();
    expect(screen.getByText("webhook:failed")).toBeInTheDocument();
    expect(screen.getByText("webhook unreachable")).toBeInTheDocument();
    expect(await screen.findByText("Agent Chat")).toBeInTheDocument();
    expect(screen.getByText("Run workspace")).toBeInTheDocument();
    expect(screen.getByText("Current state")).toBeInTheDocument();
    expect(screen.getByText("Next action")).toBeInTheDocument();
    expect(screen.getByText("Human approval required")).toBeInTheDocument();
    expect(screen.getAllByText(/Tool: shell/).length).toBeGreaterThan(0);
    expect(
      within(screen.getByRole("main")).getByText(
        "Inspecting live runner state.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Agent" }));
    await user.click(screen.getByRole("button", { name: "Permissions" }));
    await user.click(screen.getByRole("button", { name: "Warnings" }));
    await user.click(screen.getByRole("button", { name: "Errors" }));
    await user.click(screen.getByRole("button", { name: "All" }));
    await user.click(screen.getByRole("button", { name: "Download Report" }));
    expect(click).toHaveBeenCalled();
    expect(screen.getByText("final-report.md")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeVisible();
    await user.type(screen.getByLabelText("Continue chat"), "Please continue");
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/session/run_1/prompt",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("Please continue"),
        }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(
      screen.getByRole("button", { name: "Retry notification" }),
    );
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/runs/run_1/permissions/perm_1/notifications/retry",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await user.click(screen.getAllByRole("button", { name: "Approve" })[0]);

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/session/run_1/permission/perm_1",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("approve"),
        }),
      ),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/session/run_1/permission/perm_1",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("proceed_once"),
      }),
    );
  });

  it("shows mission detail and profile policy editor", async () => {
    const user = userEvent.setup();
    await act(async () => {
      await router.navigate({ to: "/admin/missions" });
    });
    render(<App />);
    await switchToEnglish(user);

    expect(await screen.findByText("Ship beta")).toBeInTheDocument();
    expect(screen.getByText("Plan mission")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /open detail/i }));
    expect(await screen.findByText("Mission Stream")).toBeInTheDocument();
    expect(screen.getByText(/Artifacts: plan.md/)).toBeInTheDocument();
    expect(await screen.findByText("Task DAG")).toBeInTheDocument();
    expect(screen.getByText("Mission Events")).toBeInTheDocument();
    expect(screen.getByText("final_report.md")).toBeInTheDocument();

    await act(async () => {
      await router.navigate({ to: "/admin/missions" });
    });
    await user.clear(screen.getByLabelText("Goal"));
    await user.type(
      screen.getByLabelText("Goal"),
      "Create a beta validation report",
    );
    await user.selectOptions(screen.getByLabelText("Strategy"), "fanout");
    await user.selectOptions(screen.getByLabelText("Adapter"), "fake");
    await user.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/missions",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("Create a beta validation report"),
        }),
      ),
    );

    await act(async () => {
      await router.navigate({ to: "/admin/profiles" });
    });
    await screen.findByText("Planner");
    expect(screen.getByText("Runtime")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await user.clear(screen.getByLabelText("Profile ID"));
    await user.type(screen.getByLabelText("Profile ID"), "planner-copy");
    await user.clear(screen.getByLabelText("Display name"));
    await user.type(screen.getByLabelText("Display name"), "Planner Copy");
    await user.type(screen.getByLabelText("Description"), " copied");
    await user.click(screen.getByRole("button", { name: "Save Profile" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/profiles",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("Planner Copy"),
        }),
      ),
    );
  });

  it("shows access policy foundations", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => "blob:access-policy");
    const revokeObjectURL = vi.fn();
    const click = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      const element = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        tagName,
      ) as HTMLAnchorElement;
      if (tagName === "a") {
        element.click = click;
      }
      return element;
    });
    await act(async () => {
      await router.navigate({ to: "/admin/access" });
    });
    render(<App />);
    await switchToEnglish(user);

    expect(await screen.findByText("Current Principal")).toBeInTheDocument();
    expect(screen.getByText("Role Matrix")).toBeInTheDocument();
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("API Tokens")).toBeInTheDocument();
    expect((await screen.findAllByText("runs:*")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(click).toHaveBeenCalled();
    await user.clear(screen.getAllByLabelText("Project ID")[0]);
    await user.type(screen.getAllByLabelText("Project ID")[0], "team1");
    await user.clear(screen.getAllByLabelText("Display name")[1]);
    await user.type(screen.getAllByLabelText("Display name")[1], "Team One");
    await user.type(screen.getByLabelText("User email"), "new@example.com");
    await user.type(screen.getByLabelText("Initial password"), "secret-12345");
    await user.clear(screen.getByLabelText("Token name"));
    await user.type(screen.getByLabelText("Token name"), "team-token");
    await user.click(screen.getAllByRole("button", { name: "Create" })[1]);
    await user.click(screen.getAllByRole("button", { name: "Create" })[0]);
    await user.click(screen.getAllByRole("button", { name: "Create" })[2]);
    expect(
      (await screen.findAllByText("new@example.com")).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("member").length).toBeGreaterThan(0);
    await user.selectOptions(screen.getAllByLabelText("Role")[1], "auditor");
    await user.click(screen.getAllByRole("button", { name: "Save role" })[0]);
    await user.type(screen.getAllByLabelText("New password")[0], "reset-12345");
    await user.click(
      screen.getAllByRole("button", { name: "Reset password" })[0],
    );
    await user.click(screen.getAllByRole("button", { name: "Disable" })[0]);
    expect(await screen.findByText("cat_created_secret")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/access/tokens",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/auth/users",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("new@example.com"),
        }),
      ),
    );
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/auth/users/owner%40example.com/roles",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("auditor"),
        }),
      ),
    );
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/auth/users/owner%40example.com/password",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("reset-12345"),
        }),
      ),
    );
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/auth/users/owner%40example.com/status",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("disabled"),
        }),
      ),
    );
  });

  it("disables access write controls for non-owner roles", async () => {
    const policy = fixtures["access/policy"] as {
      current_principal: { roles: string[]; display_name: string; id: string };
    };
    policy.current_principal = {
      id: "auditor@example.com",
      display_name: "Auditor",
      roles: ["auditor"],
    };
    const user = userEvent.setup();
    await act(async () => {
      await router.navigate({ to: "/admin/access" });
    });
    render(<App />);
    await switchToEnglish(user);

    expect(await screen.findByText("Owner only")).toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: "Create" })) {
      expect(button).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "Revoke" })).toBeDisabled();

    policy.current_principal = {
      id: "operator",
      display_name: "operator",
      roles: ["owner"],
    };
  });

  it("shows executor isolation registry", async () => {
    const user = userEvent.setup();
    await act(async () => {
      await router.navigate({ to: "/admin/executors" });
    });
    render(<App />);
    await switchToEnglish(user);

    expect(await screen.findByText("Executor Leases")).toBeInTheDocument();
    expect(screen.getByText("Registry")).toBeInTheDocument();
    expect(await screen.findByText("exec_1")).toBeInTheDocument();
    expect(screen.getAllByText("per_run_process").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Refresh" }));
  });

  it("registers and controls execution units", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await act(async () => {
      await router.navigate({ to: "/admin/units" });
    });
    render(<App />);
    await switchToEnglish(user);

    expect(
      await screen.findByRole("heading", { name: "Units" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("hk-2c2g-a")).toBeInTheDocument();
    expect(screen.getByText("adapter:qwen")).toBeInTheDocument();
    expect(
      screen.getByText(
        "2 GB memory is already running work. Keep this worker at capacity=1.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This execution unit is at capacity; new work will remain queued.",
      ),
    ).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Unit ID"));
    await user.type(screen.getByLabelText("Unit ID"), "hk-2c2g-b");
    await user.clear(screen.getByLabelText("Worker control URL"));
    await user.type(
      screen.getByLabelText("Worker control URL"),
      "https://doubaofans.site/cloud-agents-worker",
    );
    await user.clear(screen.getByLabelText("Capacity"));
    await user.type(screen.getByLabelText("Capacity"), "1");
    await user.clear(screen.getByLabelText("CPUs"));
    await user.type(screen.getByLabelText("CPUs"), "2");
    await user.clear(screen.getByLabelText("Memory GB"));
    await user.type(screen.getByLabelText("Memory GB"), "2");
    await user.clear(screen.getByLabelText("Region label"));
    await user.type(screen.getByLabelText("Region label"), "hk");
    await user.click(screen.getByRole("button", { name: "Generate" }));
    expect(await screen.findByText("Deployment Command")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("deploy_worker_vps.sh"),
    );
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await user.click(screen.getAllByRole("button", { name: "Drain" })[0]);
    await user.click(screen.getAllByRole("button", { name: "Resume" })[1]);
    await user.click(screen.getAllByRole("button", { name: "Retry" })[0]);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/workers/hk-2c2g-a/retry",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("runs operations drills and creates backups", async () => {
    const user = userEvent.setup();
    await act(async () => {
      await router.navigate({ to: "/admin/operations" });
    });
    render(<App />);
    await switchToEnglish(user);

    expect(await screen.findByText("Failure Drills")).toBeInTheDocument();
    expect(await screen.findByText("Cost Budget")).toBeInTheDocument();
    expect(await screen.findByText("acp-streamable-http")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run" }));
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/ops/backups",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("opens mobile navigation and toggles theme", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByLabelText("打开会话导航"));
    expect(screen.getAllByLabelText("搜索会话")).toHaveLength(2);
    await user.click(screen.getAllByRole("link", { name: "管理后台" }).at(-1)!);
    await user.click(await screen.findByLabelText("打开导航"));
    await user.click(screen.getAllByRole("link", { name: /任务编排/ }).at(-1)!);
    expect(
      await screen.findByRole("heading", { name: "任务编排" }),
    ).toBeInTheDocument();
    await user.click(screen.getByLabelText("打开导航"));
    await user.click(screen.getByLabelText("关闭导航"));
    await waitFor(() =>
      expect(screen.queryByText("导航")).not.toBeInTheDocument(),
    );

    await user.click(screen.getByLabelText("切换主题"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    await user.click(screen.getByLabelText("退出登录"));
    expect(
      await screen.findByRole("heading", { name: "登录" }),
    ).toBeInTheDocument();
  });

  it("summarizes runner events for the live chat timeline", () => {
    const now = new Date().toISOString();
    const liveEvents = [
      event("run.created", 1, { spec: run.spec }, now),
      event(
        "workspace.prepared",
        2,
        {
          strategy: "qwen_serve_shared",
          path: "/workspace",
        },
        now,
      ),
      event("resources.resolved", 3, { cpus: 1 }, now),
      event("run.queued", 4, {}, now),
      event("lease.claimed", 5, { worker_id: "worker_1" }, now),
      event(
        "run.started",
        6,
        { adapter: "qwen", workspace: "/workspace" },
        now,
      ),
      event(
        "input.accepted",
        7,
        { prompt_number: 1, prompt_preview: "Hello" },
        now,
      ),
      event("step.started", 8, { prompt_number: 1 }, now),
      event("step.submitted", 9, { prompt_number: 1 }, now),
      event("message.delta", 9.5, { prompt_number: 1, text: "" }, now),
      event("message.delta", 10, { prompt_number: 1, text: "Hel" }, now),
      event("message.delta", 11, { prompt_number: 1, text: "lo" }, now),
      event(
        "permission.requested",
        12,
        { permission_id: "perm_2", prompt: "Approve?" },
        now,
      ),
      event("permission.resolved", 13, { decision: "approve" }, now),
      event(
        "permission.resolve_requested",
        13.5,
        { permission_id: "perm_2", decision: "approve" },
        now,
      ),
      event("permission.stalled", 14, { permission_id: "perm_3" }, now),
      event("permission.notification.sent", 14.5, { channel: "log" }, now),
      event(
        "permission.notification.failed",
        14.55,
        { channel: "webhook" },
        now,
      ),
      event(
        "permission.resolve_failed",
        14.56,
        { reason: "worker stale" },
        now,
      ),
      event("cost.quoted", 14.6, { estimated_cost_usd: 0.01 }, now),
      event("event.gap_detected", 14.7, { missed: 2 }, now),
      event("stream.warning", 15, { reason: "reconnect" }, now),
      event("step.completed", 16, { prompt_number: 1 }, now),
      event("run.completed", 17, { final_artifact: "final_1.json" }, now),
      event("run.failed", 18, { reason: "boom" }, now),
      event("run.cancel_requested", 18.5, { reason: "user" }, now),
      event("run.cancelled", 19, { reason: "user" }, now),
      event("executor.failed", 19.5, { reason: "executor boom" }, now),
      event("turn_error", 20, { raw: true }, now),
      event(
        "adapter.event",
        21,
        { command: "npm test", cwd: "/workspace", exit_code: 0 },
        now,
      ),
      event(
        "adapter.event",
        22,
        { command: "npm lint", exit_code: 1, stderr: "lint failed" },
        now,
      ),
      event(
        "adapter.event",
        23,
        {
          adapter: "qwen",
          raw: {
            type: "session_update",
            data: {
              sessionId: "session_1",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "Qwen streamed output." },
              },
            },
          },
        },
        now,
      ),
      event(
        "adapter.event",
        24,
        {
          adapter: "qwen",
          raw: {
            type: "session_update",
            data: {
              sessionId: "session_1",
              update: {
                sessionUpdate: "tool_call_update",
                status: "completed",
                title: "ListFiles: .",
                rawInput: { path: "/workspace" },
                rawOutput: "Directory is empty.",
              },
            },
          },
        },
        now,
      ),
      event(
        "adapter.event",
        25,
        {
          adapter: "qwen",
          raw: {
            type: "session_update",
            data: {
              sessionId: "session_1",
              update: {
                sessionUpdate: "agent_thought_chunk",
                content: { type: "text", text: "hidden internal text" },
              },
            },
          },
        },
        now,
      ),
      event(
        "adapter.event",
        25.1,
        {
          adapter: "qwen",
          raw: {
            type: "session_update",
            data: {
              sessionId: "session_1",
              update: {
                sessionUpdate: "agent_thought_chunk",
                content: { type: "text", text: "another hidden chunk" },
              },
            },
          },
        },
        now,
      ),
    ];

    const transcript = __testUtils.runnerTranscript(liveEvents);
    const plannerProfile = (
      fixtures.profiles as {
        profiles: Array<Parameters<typeof __testUtils.copyProfile>[0]>;
      }
    ).profiles[0];

    expect(transcript.map((item) => item.title)).toContain("Agent output #1");
    expect(
      transcript.find((item) => item.title === "Agent output #1")?.body,
    ).toBe("Hello");
    expect(transcript.find((item) => item.title === "Agent output")?.body).toBe(
      "Qwen streamed output.",
    );
    expect(transcript.map((item) => item.body)).toContain(
      [
        "ListFiles: .",
        "status: completed",
        'input: {\n  "path": "/workspace"\n}',
        "output: Directory is empty.",
      ].join("\n"),
    );
    expect(transcript.map((item) => item.title)).toContain(
      "Permission required",
    );
    expect(transcript.map((item) => item.title)).toContain(
      "Permission decision submitted",
    );
    expect(transcript.map((item) => item.title)).toContain(
      "Permission decision failed",
    );
    expect(transcript.map((item) => item.title)).toContain(
      "Permission notification",
    );
    expect(transcript.map((item) => item.title)).toContain("Agent progress");
    expect(transcript.map((item) => item.body).join("\n")).not.toContain(
      "hidden internal text",
    );
    expect(transcript.map((item) => item.title)).toContain("Run failed");
    expect(transcript.map((item) => item.title)).toContain("Cancel requested");
    expect(transcript.map((item) => item.title)).toContain("Executor failed");
    expect(transcript.map((item) => item.title)).toContain(
      "Cost budget checked",
    );
    expect(transcript.map((item) => item.title)).toContain(
      "Event stream recovered",
    );
    expect(transcript.map((item) => item.title)).toContain("turn_error");
    expect(__testUtils.mergeEvents(liveEvents, [])).toBe(liveEvents);
    expect(__testUtils.mergeEvents(liveEvents, [liveEvents[0]])).toBe(
      liveEvents,
    );
    expect(__testUtils.isTerminalEvent("run.completed")).toBe(true);
    expect(__testUtils.isTerminalEvent("step.completed")).toBe(false);
    expect(__testUtils.connectionLabel("fallback")).toBe("polling");
    expect(__testUtils.connectionTone("live")).toBe("ok");
    expect(__testUtils.connectionTone("reconnecting")).toBe("warn");
    expect(__testUtils.connectionTone("closed")).toBe("neutral");
    expect(__testUtils.bubbleClass("error")).toContain("destructive");
    expect(__testUtils.filterLabel("warning")).toBe("Warnings");
    expect(__testUtils.filterTranscript(transcript, "all")).toBe(transcript);
    expect(__testUtils.filterTranscript(transcript, "agent")).toHaveLength(2);
    expect(
      __testUtils.filterTranscript(transcript, "process").length,
    ).toBeGreaterThan(5);
    expect(
      __testUtils.filterTranscript(transcript, "tools").length,
    ).toBeGreaterThan(0);
    expect(
      __testUtils.filterTranscript(transcript, "permission").length,
    ).toBeGreaterThan(1);
    expect(
      __testUtils.filterTranscript(transcript, "warning").length,
    ).toBeGreaterThan(1);
    expect(
      __testUtils.filterTranscript(transcript, "error").length,
    ).toBeGreaterThan(1);
    expect(__testUtils.runnerSignal(liveEvents.at(-1), "running").label).toBe(
      "active",
    );
    expect(__testUtils.runnerSignal(undefined, "running").label).toBe(
      "waiting",
    );
    expect(__testUtils.runnerSignal(liveEvents[0], "completed").label).toBe(
      "terminal",
    );
    expect(
      __testUtils.runnerSignal(
        event(
          "run.started",
          30,
          {},
          new Date(Date.now() - 180_000).toISOString(),
        ),
        "running",
      ).label,
    ).toBe("stalled");
    expect(__testUtils.runnerReadableReport(transcript, liveEvents)).toContain(
      "Runner Execution Report",
    );
    expect(__testUtils.runnerProcessSummary(liveEvents, transcript)).toEqual(
      expect.objectContaining({
        messageChunks: 2,
        permissionRequests: 1,
        progressSignals: 2,
        rawAdapterEvents: 6,
        toolCalls: 2,
      }),
    );
    const daemon = [
      {
        id: 1,
        v: 1,
        type: "session_update",
        data: {
          update: {
            sessionUpdate: "user_message_chunk",
            content: { text: "hello agent" },
          },
        },
        _meta: { serverTimestamp: Date.now(), runtimeSequence: 1 },
      },
      {
        id: "2",
        v: 1,
        type: "session_update",
        data: {
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Hel" },
          },
        },
        _meta: { serverTimestamp: Date.now(), runtimeSequence: 2 },
      },
      {
        id: "3",
        v: 1,
        type: "session_update",
        data: {
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "lo" },
          },
        },
        _meta: { serverTimestamp: Date.now(), runtimeSequence: 3 },
      },
      {
        id: "seq-tool",
        v: 1,
        type: "session_update",
        data: {
          update: {
            sessionUpdate: "tool_call_update",
            toolCall: {
              name: "shell",
              status: "completed",
              input: { command: "npm test" },
              output: { ok: true },
            },
          },
        },
        _meta: { serverTimestamp: Date.now(), runtimeSequence: 4 },
      },
      {
        id: 5,
        v: 1,
        type: "shell_output",
        data: { stdout: "stdout text", stderr: "" },
        _meta: { serverTimestamp: Date.now(), runtimeSequence: 5 },
      },
      {
        id: 6,
        v: 1,
        type: "permission_request",
        data: {
          requestId: "perm_daemon",
          prompt: "Approve command?",
          tool: "shell",
          options: [{ id: "proceed_once", label: "Approve" }],
        },
        _meta: { serverTimestamp: Date.now(), runtimeSequence: 6 },
      },
      {
        id: 7,
        v: 1,
        type: "permission_resolved",
        data: { requestId: "perm_daemon", decision: "approve" },
        _meta: { serverTimestamp: Date.now(), runtimeSequence: 7 },
      },
      {
        id: 8,
        v: 1,
        type: "turn_complete",
        data: {},
        _meta: { serverTimestamp: Date.now(), runtimeSequence: 8 },
      },
    ] as const;
    const daemonTranscript = __testUtils.daemonRunnerTranscript([...daemon]);
    expect(daemonTranscript).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "operator", body: "hello agent" }),
        expect.objectContaining({ role: "agent", body: "Hello" }),
        expect.objectContaining({
          title: "shell · completed",
          body: expect.stringContaining("command: npm test"),
        }),
        expect.objectContaining({ title: "Shell output", body: "stdout text" }),
        expect.objectContaining({ title: "Permission required" }),
        expect.objectContaining({ title: "Permission resolved" }),
        expect.objectContaining({ title: "Runner completed" }),
      ]),
    );
    expect(
      __testUtils.daemonRunnerProcessSummary([...daemon], daemonTranscript),
    ).toEqual(
      expect.objectContaining({
        messageChunks: 2,
        permissionRequests: 1,
        toolCalls: 2,
      }),
    );
    expect(__testUtils.daemonResolvedPermissionIds([...daemon])).toEqual(
      new Set(["perm_daemon"]),
    );
    expect(__testUtils.daemonPendingPermissionRequests([...daemon])).toEqual(
      [],
    );
    expect(__testUtils.mergeDaemonEvents([], [...daemon])).toHaveLength(8);
    expect(__testUtils.daemonSequence(daemon[3])).toBe(4);
    expect(__testUtils.daemonCreatedAt(daemon[0])).toContain("T");
    expect(__testUtils.isTerminalDaemonEvent("turn_complete")).toBe(true);
    const daemonEdges = [
      {
        id: "thought",
        v: 1,
        type: "session_update",
        data: {
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: [{ content: { text: "hidden" } }],
          },
        },
      },
      {
        id: "thought-2",
        v: 1,
        type: "session_update",
        data: {
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: [{ content: { text: "still hidden" } }],
          },
        },
      },
      {
        id: "empty",
        v: 1,
        type: "session_update",
        data: {
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { text: "" },
          },
        },
      },
      {
        id: "empty-user",
        v: 1,
        type: "session_update",
        data: {
          update: {
            sessionUpdate: "user_message_chunk",
          },
        },
      },
      {
        id: "array-user",
        v: 1,
        type: "session_update",
        data: {
          update: {
            sessionUpdate: "user_message_chunk",
            content: [{ content: { text: "array prompt" } }],
          },
        },
      },
      {
        id: "status",
        v: 1,
        type: "session_update",
        data: {
          update: {
            sessionUpdate: "status",
            status: { eventType: "custom.event", message: "custom status" },
          },
        },
      },
      {
        id: "unknown-session-update",
        v: 1,
        type: "session_update",
        data: {
          update: {
            sessionUpdate: "unknown_update",
            message: "ignored update",
          },
        },
      },
      {
        id: "failed-tool",
        v: 1,
        type: "session_update",
        data: {
          update: {
            sessionUpdate: "tool_call_update",
            status: "failed",
            title: "Run shell",
            rawInput: "npm lint",
            rawOutput: "lint failed",
          },
        },
      },
      {
        id: "title-tool",
        v: 1,
        type: "session_update",
        data: {
          update: {
            sessionUpdate: "tool_call",
            status: "running",
            title: "Custom title",
            content: [{ text: "content array text" }],
          },
        },
      },
      {
        id: "fallback-tool",
        v: 1,
        type: "session_update",
        data: {
          update: {
            sessionUpdate: "tool_call",
            rawInput: { path: "/tmp" },
          },
        },
      },
      {
        id: "stderr",
        v: 1,
        type: "shell_output",
        data: { stderr: "permission denied" },
      },
      {
        id: "pending-permission",
        v: 1,
        type: "permission_request",
        data: { requestId: "perm_pending", options: [{}] },
      },
      {
        id: "error",
        v: 1,
        type: "turn_error",
        data: {},
      },
      {
        id: "cancel",
        v: 1,
        type: "prompt_cancelled",
        data: {},
      },
      {
        id: "stream",
        v: 1,
        type: "stream_error",
        data: {},
      },
      {
        id: "unknown",
        v: 1,
        type: "unknown_event",
        data: { ok: true },
      },
    ] as const;
    const edgeTranscript = __testUtils.daemonRunnerTranscript([...daemonEdges]);
    expect(edgeTranscript).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Agent progress" }),
        expect.objectContaining({
          title: "Prompt submitted",
          body: "User input was accepted.",
        }),
        expect.objectContaining({
          title: "Prompt submitted",
          body: "array prompt",
        }),
        expect.objectContaining({
          title: "custom.event",
          body: "custom status",
        }),
        expect.objectContaining({ role: "error", title: "Run shell · failed" }),
        expect.objectContaining({
          title: "Custom title · running",
          body: expect.stringContaining("content: content array text"),
        }),
        expect.objectContaining({ title: "Tool call" }),
        expect.objectContaining({
          role: "warning",
          title: "Shell output",
          body: "permission denied",
        }),
        expect.objectContaining({ title: "Runner error" }),
        expect.objectContaining({ title: "Prompt cancelled" }),
        expect.objectContaining({ title: "Stream recovered" }),
        expect.objectContaining({ title: "unknown_event" }),
      ]),
    );
    expect(
      edgeTranscript.find((item) => item.role === "agent" && !item.body.trim()),
    ).toBeUndefined();
    expect(
      __testUtils.daemonPendingPermissionRequests([...daemonEdges]),
    ).toEqual([
      expect.objectContaining({
        permission_id: "perm_pending",
        options: [{ id: "approve" }],
      }),
    ]);
    expect(__testUtils.daemonSequence(daemonEdges[0])).toBe(0);
    expect(__testUtils.daemonCreatedAt(daemonEdges[0])).toContain("T");
    expect(__testUtils.copyProfile(plannerProfile).id).toBe("planner-copy");
    expect(
      __testUtils.pendingPermissionRequests([
        event(
          "permission.requested",
          40,
          { permission_id: "perm_pending" },
          now,
        ),
      ]),
    ).toHaveLength(1);
    expect(
      __testUtils.pendingPermissionRequests([
        event(
          "permission.requested",
          41,
          { permission_id: "perm_submitted" },
          now,
        ),
        event(
          "permission.resolve_requested",
          42,
          { permission_id: "perm_submitted" },
          now,
        ),
      ]),
    ).toHaveLength(0);
    expect(
      __testUtils.pendingPermissionRequests([
        event(
          "permission.requested",
          43,
          { raw: { data: { requestId: "perm_qwen" } } },
          now,
        ),
        event(
          "permission.resolve_requested",
          44,
          { requestId: "perm_qwen" },
          now,
        ),
      ]),
    ).toHaveLength(0);
    expect(
      __testUtils.pendingPermissionRequests([
        event(
          "permission.requested",
          45,
          { permission_id: "perm_completed" },
          now,
        ),
        event("run.completed", 46, {}, now),
      ]),
    ).toHaveLength(0);
    expect(
      __testUtils.permissionDecisionPayload(
        { id: "proceed_once", label: "Allow" },
        "reason",
      ),
    ).toEqual({
      decision: "approve",
      option_id: "proceed_once",
      reason: "reason",
    });
    expect(
      __testUtils.permissionDecisionForOption({
        id: "cancel",
        label: "Reject",
      }),
    ).toBe("cancel");
    expect(__testUtils.compactJson(null)).toBe("");
    expect(__testUtils.compactJson({ ok: true })).toContain("ok");
    expect(__testUtils.emptyProfile().id).toBe("custom-profile");
    expect(__testUtils.emptyToNull("  ")).toBeNull();
    expect(__testUtils.formatBytes(1024)).toBe("1.0 KB");
    expect(__testUtils.prettyJson({ ok: true })).toContain("ok");
    expect(__testUtils.parseJsonObject("{}", "test")).toEqual({});
    expect(() => __testUtils.parseJsonObject("[]", "test")).toThrow(
      "test must be a JSON object",
    );
    expect(
      __testUtils.toolEventBody(
        event("adapter.event", 31, { tool: "shell", stdout: "ok" }, now),
      ),
    ).toContain("shell");
    expect(
      __testUtils.toolEventRole(
        event("adapter.event", 32, { status: "failed" }, now),
      ),
    ).toBe("error");
    expect(
      __testUtils.toolEventRole(
        event(
          "adapter.event",
          32.1,
          {
            adapter: "qwen",
            raw: {
              type: "session_update",
              data: {
                update: {
                  sessionUpdate: "tool_call_update",
                  status: "failed",
                },
              },
            },
          },
          now,
        ),
      ),
    ).toBe("error");
    expect(
      __testUtils.runnerTranscript([event("run.completed", 33, {}, now)])[0]
        .body,
    ).toBe("The runner reached a terminal success state.");
    expect(
      __testUtils.runnerTranscript([
        event("run.started", 34, { adapter: "qwen" }, now),
      ])[0].body,
    ).toBe("qwen");
    expect(
      __testUtils.runnerTranscript([event("run.started", 34, {}, now)])[0].body,
    ).toBe("Session is active.");
    expect(
      __testUtils.runnerTranscript([
        event("input.accepted", 35, { prompt_number: 3 }, now),
      ])[0].body,
    ).toBe("Prompt #3");
    expect(
      __testUtils.runnerTranscript([
        event(
          "adapter.event",
          36,
          {
            raw: {
              data: {
                update: {
                  sessionUpdate: "agent_thought_chunk",
                  content: { text: "private reasoning chunk" },
                },
              },
            },
          },
          now,
        ),
      ])[0].body,
    ).toBe("Model is analyzing the request and preparing the next action.");
    expect(
      __testUtils.transcriptItemForEvent(
        event(
          "adapter.event",
          37,
          {
            raw: {
              data: {
                update: {
                  sessionUpdate: "agent_thought_chunk",
                  content: { text: "private reasoning chunk" },
                },
              },
            },
          },
          now,
        ),
      ),
    ).toBeNull();
    expect(
      __testUtils.runnerTranscript([event("unmapped.event", 34, {}, now)]),
    ).toHaveLength(0);
    expect(
      __testUtils.toolEventBody(
        event("adapter.event", 35, { name: "named-tool" }, now),
      ),
    ).toContain("named-tool");
    expect(
      __testUtils.toolEventBody(
        event(
          "adapter.event",
          35.1,
          {
            adapter: "qwen",
            raw: {
              type: "session_update",
              data: {
                update: {
                  sessionUpdate: "tool_call",
                  status: "running",
                  _meta: { toolName: "run_shell_command" },
                  rawInput: {
                    command: "pwd",
                    cwd: "/workspace",
                  },
                  rawOutput: { stdout: "/workspace" },
                  content: [
                    { content: { text: "tool content" } },
                    { content: { text: "" } },
                  ],
                },
              },
            },
          },
          now,
        ),
      ),
    ).toContain("command: pwd");
    expect(
      __testUtils.toolEventBody(
        event(
          "adapter.event",
          35.2,
          {
            adapter: "qwen",
            raw: {
              type: "session_update",
              data: {
                update: {
                  sessionUpdate: "tool_call_update",
                  rawInput: { cmd: "echo ok" },
                  rawOutput: { stdout: "ok" },
                },
              },
            },
          },
          now,
        ),
      ),
    ).toContain("command: echo ok");
    expect(
      __testUtils.toolEventBody(
        event(
          "adapter.event",
          35.3,
          {
            adapter: "qwen",
            raw: {
              type: "session_update",
              data: {
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { text: "not a tool" },
                },
              },
            },
          },
          now,
        ),
      ),
    ).toBe("adapter event");
    expect(
      __testUtils.toolEventBody(
        event(
          "adapter.event",
          35.4,
          {
            adapter: "qwen",
            raw: {
              type: "session_update",
              data: {
                update: {
                  sessionUpdate: "tool_call_update",
                  title: "No input tool",
                },
              },
            },
          },
          now,
        ),
      ),
    ).toContain("No input tool");
    expect(
      __testUtils.runnerTranscript([
        event(
          "adapter.event",
          35.5,
          {
            adapter: "qwen",
            raw: {
              type: "session_update",
              data: {
                update: {
                  sessionUpdate: "user_message_chunk",
                  content: { text: "hello" },
                },
              },
            },
          },
          now,
        ),
      ])[0].title,
    ).toBe("User input streamed");
    expect(__testUtils.toolEventBody(event("adapter.event", 36, {}, now))).toBe(
      "adapter event",
    );
    expect(
      __testUtils.runTaskProgress(
        { ...run, status: "queued" },
        [event("run.queued", 37, {}, now)],
        [],
      ).phase,
    ).toBe("排队中");
    expect(
      __testUtils.runTaskProgress(
        { ...run, status: "completed" },
        [event("run.completed", 38, {}, now)],
        [
          {
            name: "final-report.md",
            size_bytes: 12,
            updated_at: now,
          },
        ],
      ).phase,
    ).toBe("已完成");
    expect(
      __testUtils.runTaskProgress(
        { ...run, status: "completed" },
        [event("run.completed", 38.1, {}, now)],
        [],
      ).nextAction,
    ).toBe("下载事件和审计包完成复盘。");
    expect(
      __testUtils.runTaskProgress(
        { ...run, status: "failed" },
        [event("executor.failed", 39, {}, now)],
        [],
      ).tone,
    ).toBe("bad");
    expect(
      __testUtils.runTaskProgress(
        { ...run, status: "running" },
        [
          event(
            "permission.requested",
            39.1,
            { permission_id: "perm_wait" },
            now,
          ),
        ],
        [],
      ).phase,
    ).toBe("等待权限审批");
    expect(
      __testUtils.runTaskProgress(
        { ...run, status: "running" },
        [
          event("permission.requested", 39.15, { requestId: "perm_done" }, now),
          event("run.completed", 39.16, {}, now),
        ],
        [],
      ).phase,
    ).toBe("已完成");
    expect(
      __testUtils.runTaskProgress(
        { ...run, status: "running" },
        [
          event(
            "permission.resolve_requested",
            39.2,
            { permission_id: "perm_wait" },
            now,
          ),
        ],
        [],
      ).phase,
    ).toBe("等待执行单元应用审批");
    expect(
      __testUtils.runTaskProgress(
        { ...run, status: "cancelled" },
        [event("run.cancelled", 39.3, {}, now)],
        [],
      ).phase,
    ).toBe("已取消");
    expect(
      __testUtils.runTaskProgress(
        undefined,
        [
          event(
            "input.accepted",
            39.4,
            { prompt_preview: "fallback prompt" },
            now,
          ),
        ],
        [],
      ).goal,
    ).toBe("fallback prompt");
    expect(
      __testUtils.permissionDecisionForOption({
        id: "deny_once",
        label: "Deny",
      }),
    ).toBe("cancel");
    expect(__testUtils.statusLine({ running: 2 })).toBe("running 2");
    expect(__testUtils.stringValue(123)).toBe("123");
    expect(__testUtils.timeAgo(undefined)).toBe("-");
    expect(__testUtils.money(1.25)).toBe("$1.25");
    expect(__testUtils.money(null)).toBe("$0.00");
    expect(
      __testUtils.registryValue({ config: { ok: true } }, "config"),
    ).toEqual({
      ok: true,
    });
    expect(__testUtils.registryValue({ config: [] }, "config")).toEqual({});
    expect(__testUtils.objectValue({ ok: true })).toEqual({ ok: true });
    expect(__testUtils.objectValue(null)).toEqual({});
    expect(__testUtils.defaultWorkerControlUrl()).toContain(
      "/cloud-agents-worker",
    );
    window.history.pushState({}, "", "/cloud-agents/");
    expect(__testUtils.defaultWorkerControlUrl()).toContain(
      "/cloud-agents-worker",
    );
    window.history.pushState({}, "", "/agentflow/");
    expect(__testUtils.defaultWorkerControlUrl()).toContain(
      "/agentflow-worker",
    );
    window.history.pushState({}, "", "/");
    expect(
      __testUtils.canPreviewArtifact({
        name: "diagnostics.json",
        size_bytes: 512,
        updated_at: now,
      }),
    ).toBe(true);
    expect(
      __testUtils.canPreviewArtifact({
        name: "video.bin",
        size_bytes: 512,
        updated_at: now,
      }),
    ).toBe(false);
    expect(
      __testUtils.canPreviewArtifact({
        name: "large.jsonl",
        size_bytes: 300 * 1024,
        updated_at: now,
      }),
    ).toBe(false);
    expect(__testUtils.shellSingleQuote("worker's token")).toBe(
      "'worker'\"'\"'s token'",
    );
    expect(
      __testUtils.workerNoSourceDeployCommand({
        worker_id: "hk-worker",
        capacity: 1,
        control_url: "https://doubaofans.site/cloud-agents-worker",
        token: {
          token_id: "token_worker",
          name: "worker-hk-worker",
          principal_id: "operator",
          scopes: ["workers:*"],
          status: "active",
          token_prefix: "cat_worker",
          token: "worker-token-placeholder",
          created_at: now,
          updated_at: now,
          metadata: {},
        },
        metadata: {},
        deploy_command: "local-source-command",
      }),
    ).toContain("raw.githubusercontent.com/chiga0/agent-flow");
    expect(
      __testUtils.workerBadges({
        worker_id: "worker",
        status: "active",
        capacity: 1,
        active_count: 0,
        heartbeat_at: now,
        lease_ttl_seconds: 60,
        metadata: {
          labels: { region: "hk" },
          resources: { cpus: 2 },
          capabilities: { adapters: ["fake"] },
        },
      }),
    ).toEqual(["region:hk", "cpus:2", "adapter:fake"]);
    expect(
      __testUtils.workerResourceRows({
        worker_id: "metrics-worker",
        status: "active",
        capacity: 2,
        active_count: 1,
        heartbeat_at: now,
        lease_ttl_seconds: 60,
        metadata: {
          resources: { cpus: 2 },
          metrics: {
            cpu_percent: 90,
            memory_percent: "70",
            disk_percent: 86,
            swap_percent: 41,
            load_average: 1.5,
          },
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "cpu", tone: "warn", value: "90%" }),
        expect.objectContaining({ label: "memory", value: "70%" }),
        expect.objectContaining({ label: "disk", tone: "warn" }),
        expect.objectContaining({ label: "swap", tone: "warn" }),
        expect.objectContaining({ label: "load", value: "1.50" }),
      ]),
    );
    expect(
      __testUtils.workerResourceRows({
        worker_id: "declared-worker",
        status: "active",
        capacity: 1,
        active_count: 1,
        heartbeat_at: now,
        lease_ttl_seconds: 60,
        metadata: { resources: { cpus: 1, memory_gb: 2 } },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "capacity", tone: "warn" }),
        expect.objectContaining({ label: "memory", tone: "warn" }),
      ]),
    );
    expect(
      __testUtils.workerResourceRows({
        worker_id: "zero-capacity",
        status: "active",
        capacity: 0,
        active_count: 0,
        heartbeat_at: now,
        lease_ttl_seconds: 60,
        metadata: { resources: { cpu_percent: "bad", memory_percent: 0 / 0 } },
      }),
    ).toEqual([expect.objectContaining({ label: "capacity", percent: 0 })]);
    expect(
      __testUtils.workerResourceRows({
        worker_id: "nan-capacity",
        status: "active",
        capacity: 1,
        active_count: Number.NaN,
        heartbeat_at: now,
        lease_ttl_seconds: 60,
        metadata: {},
      })[0],
    ).toEqual(expect.objectContaining({ label: "capacity", percent: 0 }));
    expect(
      __testUtils.workerResourceWarnings({
        worker_id: "stale-worker",
        status: "stale",
        capacity: 1,
        active_count: 1,
        heartbeat_at: now,
        lease_ttl_seconds: 60,
        metadata: { resources: { memory_gb: 2 } },
      }),
    ).toEqual([
      "units.lowMemoryWarning",
      "units.capacityFullWarning",
      "units.staleWarning",
    ]);
    expect(
      __testUtils.runnerStallExplanation(
        [event("permission.requested", 40, { permission_id: "perm_x" }, now)],
        "running",
      ),
    ).toBe("live.stallPermission");
    expect(
      __testUtils.runnerStallExplanation(
        [event("run.queued", 41, {}, now)],
        "running",
        [],
      ),
    ).toBe("live.stallQueuedNoWorker");
    expect(
      __testUtils.runnerStallExplanation(
        [event("run.queued", 42, {}, now)],
        "running",
        [
          {
            worker_id: "worker",
            status: "active",
            capacity: 1,
            active_count: 1,
            heartbeat_at: now,
            lease_ttl_seconds: 60,
            metadata: {},
          },
        ],
      ),
    ).toBe("live.stallQueuedCapacity");
    expect(
      __testUtils.runnerStallExplanation(
        [event("lease.claimed", 43, { worker_id: "worker" }, now)],
        "running",
        [
          {
            worker_id: "worker",
            status: "stale",
            capacity: 1,
            active_count: 1,
            heartbeat_at: now,
            lease_ttl_seconds: 60,
            metadata: {},
          },
        ],
      ),
    ).toBe("live.stallWorkerStale");
    expect(
      __testUtils.runnerStallExplanation(
        [event("executor.failed", 44, {}, now)],
        "running",
      ),
    ).toBe("live.stallExecutorFailed");
    expect(__testUtils.runnerStallExplanation([], "completed")).toBe(
      "live.stallTerminal",
    );
    expect(__testUtils.runnerStallExplanation([], "running")).toBe(
      "live.stallNoRecentEvent",
    );
    expect(__testUtils.missionChatItems(mission, missionEvents)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Plan mission · planner",
          body: expect.stringContaining("Artifacts: plan.md"),
          runId: "run_1",
        }),
        expect.objectContaining({
          title: "task.created",
          body: expect.stringContaining("Task: plan"),
        }),
      ]),
    );
    expect(
      __testUtils.missionChatItems(mission, missionEvents, {
        run_1: "planner is producing a concrete plan",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          body: expect.stringContaining(
            "Last output: planner is producing a concrete plan",
          ),
        }),
      ]),
    );
    expect(
      __testUtils.latestRunOutput([
        event("run.started", 1, {}, now),
        event("message.delta", 2, { text: "streaming output" }, now),
      ]),
    ).toBe("streaming output");
    expect(
      __testUtils.permissionContextRows({
        permission_id: "perm_1",
        raw: {
          risk: "high",
          cwd: "/workspace",
          payload: { command: "rm -rf build-cache" },
        },
      }),
    ).toEqual([
      { label: "live.permissionRisk", value: "high" },
      { label: "live.permissionCwd", value: "/workspace" },
      { label: "live.permissionCommand", value: "rm -rf build-cache" },
    ]);
    expect(
      __testUtils.permissionContextRows({
        permission_id: "perm_2",
        raw: {
          raw: {
            risk_level: "medium",
            workspace: "/repo",
            cmd: "npm test",
          },
        },
      }),
    ).toEqual([
      { label: "live.permissionRisk", value: "medium" },
      { label: "live.permissionCwd", value: "/repo" },
      { label: "live.permissionCommand", value: "npm test" },
    ]);
    expect(
      __testUtils.permissionContextRows({ permission_id: "empty" }),
    ).toEqual([]);
    expect(
      __testUtils.latestRunOutput([
        event(
          "adapter.event",
          3,
          {
            raw: {
              data: {
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { text: "nested qwen chunk" },
                },
              },
            },
          },
          now,
        ),
      ]),
    ).toBe("nested qwen chunk");
    expect(
      __testUtils.latestRunOutput([event("run.started", 1, {}, now)]),
    ).toBe(undefined);
    expect(
      __shellTestUtils.dockPendingPermission([
        event("permission.requested", 1, { permission_id: "perm_1" }, now),
      ]),
    ).toEqual(expect.objectContaining({ permission_id: "perm_1" }));
    expect(
      __shellTestUtils.dockPendingPermission([
        event("permission.requested", 1, { permission_id: "perm_1" }, now),
        event("permission.resolved", 2, { permission_id: "perm_1" }, now),
      ]),
    ).toBeUndefined();
    expect(
      __shellTestUtils.dockPendingPermission([
        event(
          "permission.requested",
          1,
          { raw: { data: { requestId: "perm_2" } } },
          now,
        ),
        event("permission.resolve_requested", 2, { requestId: "perm_2" }, now),
      ]),
    ).toBeUndefined();
    expect(
      __shellTestUtils.dockPendingPermission([
        event("permission.requested", 1, { permission_id: "perm_3" }, now),
        event("run.completed", 2, {}, now),
      ]),
    ).toBeUndefined();
    expect(
      __shellTestUtils.dockRunStatus("running", [
        event("run.completed", 2, {}, now),
      ]),
    ).toBe("completed");
    expect(
      __shellTestUtils.dockRunPreview([
        event("input.accepted", 1, { prompt_preview: "operator prompt" }, now),
      ]),
    ).toBe("operator prompt");
    expect(
      __shellTestUtils.dockRunPreview([
        event(
          "adapter.event",
          2,
          {
            raw: {
              data: {
                update: {
                  content: { text: "dock nested output" },
                },
              },
            },
          },
          now,
        ),
      ]),
    ).toBe("dock nested output");
    expect(
      __shellTestUtils.dockRunPreview([event("run.started", 1, {}, now)]),
    ).toBe(undefined);
    expect(__testUtils.missionChatItems(undefined, [])).toHaveLength(0);
    expect(
      __testUtils.missionChatItems(
        {
          ...mission,
          tasks: [
            {
              task_id: "write",
              title: "Write report",
              profile_id: "doc-writer",
              status: "running",
              run_id: null,
              depends_on: ["plan"],
              result: { summary: "drafting" },
            },
            {
              task_id: "ship",
              title: "Ship report",
              profile_id: "operator",
              status: "pending",
              run_id: null,
              depends_on: ["write"],
            },
            {
              task_id: "archive",
              title: "Archive",
              profile_id: "doc-writer",
              status: "completed",
              run_id: null,
              depends_on: [],
              result: { artifacts: ["archive.md", { name: "manifest.json" }] },
            },
          ],
        },
        [
          event("mission.completed", 50, { status: "completed" }, now),
          event("task.failed", 51, { run_id: "run_failed" }, now),
        ].map((item) => ({
          ...item,
          mission_id: "mission_1",
        })),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ body: expect.stringContaining("Result:") }),
        expect.objectContaining({ body: "Dependencies: write\nNo result yet" }),
        expect.objectContaining({
          body: expect.stringContaining("Artifacts: archive.md, manifest.json"),
        }),
        expect.objectContaining({ status: "completed" }),
        expect.objectContaining({ status: "failed" }),
      ]),
    );
  });

  it("downloads a readable runner report", () => {
    const createObjectURL = vi.fn(() => "blob:report");
    const revokeObjectURL = vi.fn();
    const click = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      const element = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        tagName,
      ) as HTMLAnchorElement;
      if (tagName === "a") {
        element.click = click;
      }
      return element;
    });

    __testUtils.downloadText("report.md", "# report");

    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:report");
  });

  it("fetches text artifacts and surfaces preview errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("preview body", { status: 200 }))
        .mockResolvedValueOnce(
          new Response("missing artifact", { status: 404 }),
        ),
    );

    await expect(__testUtils.fetchTextArtifact("/artifact.txt")).resolves.toBe(
      "preview body",
    );
    await expect(__testUtils.fetchTextArtifact("/missing.txt")).rejects.toThrow(
      "missing artifact",
    );
  });

  it("copies text with the textarea fallback", () => {
    const execCommand = vi.fn();
    const select = vi.fn();
    vi.stubGlobal("navigator", {});
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    vi.spyOn(document, "execCommand").mockImplementation(execCommand);
    vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      const element = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        tagName,
      ) as HTMLTextAreaElement;
      if (tagName === "textarea") {
        element.select = select;
      }
      return element;
    });

    __testUtils.copyText("worker token");

    expect(select).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith("copy");
  });
});

function event(
  type: string,
  sequence: number,
  data: Record<string, unknown>,
  createdAt: string,
) {
  return {
    id: `evt_${sequence}`,
    run_id: "run_1",
    sequence,
    type,
    created_at: createdAt,
    data,
  };
}

async function switchToEnglish(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByLabelText("切换语言"));
}

async function fetchMock(input: RequestInfo | URL, init?: RequestInit) {
  const url = typeof input === "string" ? input : input.toString();
  const path = url.replace(/^https?:\/\/[^/]+\//, "").replace(/^\//, "");
  if (emptyApprovalQueues && path.startsWith("approvals?status=")) {
    return jsonResponse({ approvals: [] });
  }
  if (emptyApprovalQueues && path === "mobile/snapshot") {
    return jsonResponse({
      snapshot_version: 1,
      projection_version: 1,
      notification_cursor: 0,
      generated_at: "invalid-date",
      counts: { pending_approvals: 0, active: 0, waiting_user: 0 },
      approvals: [],
      active_conversations: [],
      recent_conversations: [],
      stateless: true,
    });
  }
  if (path === "auth/session") {
    return jsonResponse({
      authenticated: authSessionAuthenticated,
      login_required: true,
      principal: authSessionAuthenticated
        ? {
            id: "owner@example.com",
            email: "owner@example.com",
            display_name: "Owner",
            roles: ["owner"],
          }
        : null,
    });
  }
  if (init?.method === "POST" && path === "auth/login") {
    const body = JSON.parse(String(init.body ?? "{}")) as {
      email?: string;
      password?: string;
    };
    if (body.email !== "owner@example.com" || body.password !== "secret") {
      return jsonResponse({ error: "invalid credentials" }, 401);
    }
    authSessionAuthenticated = true;
    return jsonResponse({
      authenticated: true,
      principal: {
        id: "owner@example.com",
        email: "owner@example.com",
        display_name: "Owner",
        roles: ["owner"],
      },
    });
  }
  if (init?.method === "POST" && path === "auth/logout") {
    authSessionAuthenticated = false;
    return jsonResponse({ authenticated: false });
  }
  if (init?.method === "POST" && path === "runs") {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return jsonResponse({ ...run, run_id: "run_created", status: "queued" });
  }
  if (init?.method === "POST" && path === "tasks") {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return jsonResponse({
      ...task,
      task_id: "run_created",
      title: "Prepare a customer report",
      goal: "Prepare a customer report",
      status: "queued",
      needs_attention: false,
      source: { run_id: "run_created", mission_id: null },
    });
  }
  if (path === "tasks/run_created") {
    return jsonResponse({
      ...task,
      task_id: "run_created",
      title: "Prepare a customer report",
      goal: "Prepare a customer report",
      status: "queued",
      needs_attention: false,
      source: { run_id: "run_created", mission_id: null },
    });
  }
  if (path === "tasks/run_created/events.json") {
    return jsonResponse({
      events: taskEvents.map((item) => ({ ...item, task_id: "run_created" })),
    });
  }
  if (path === "tasks/run_created/artifacts") {
    return jsonResponse({ artifacts: [] });
  }
  if (path === "tasks/run_created/result") {
    return jsonResponse({
      task_id: "run_created",
      status: "queued",
      summary: null,
      artifacts: [],
      completed: false,
      generated_at: new Date().toISOString(),
    });
  }
  if (init?.method === "POST" && path === "tasks/run_1/messages") {
    return jsonResponse({ accepted: true, task_id: "run_1", run_id: "run_1" });
  }
  if (init?.method === "POST" && path === "tasks/run_1/cancel") {
    return jsonResponse({ ...task, status: "cancelled" });
  }
  if (init?.method === "POST" && path === "conversations") {
    if (failV2TaskCreate) {
      return jsonResponse({ error: "offline" }, 503);
    }
    return jsonResponse(completedConversation);
  }
  if (path.startsWith("conversations/conv_missing")) {
    return jsonResponse({ error: "not found" }, 404);
  }
  if (
    init?.method === "POST" &&
    path === `conversations/${completedConversation.conversation_id}/messages`
  ) {
    if (failConversationMessage) {
      return jsonResponse({ error: "relay unavailable" }, 503);
    }
    return jsonResponse({
      conversation_id: completedConversation.conversation_id,
      execution_id: "exec_v2_2",
      task_id: "task_v2_2",
      event: null,
      created_execution: true,
    });
  }
  if (
    init?.method === "POST" &&
    path.startsWith("conversations/") &&
    path.endsWith("/stop")
  ) {
    return jsonResponse({ ...completedConversation, status: "idle" });
  }
  if (init?.method === "POST" && /^approvals\/[^/]+\/decision$/.test(path)) {
    const body = JSON.parse(String(init.body ?? "{}")) as {
      action?: "approve" | "reject" | "pause" | "revise";
    };
    const status = {
      approve: "approved",
      reject: "rejected",
      pause: "paused",
      revise: "revision_requested",
    }[body.action ?? "approve"];
    return jsonResponse(
      {
        ...(path.includes(lowRiskApproval.approval_id)
          ? lowRiskApproval
          : pendingApproval),
        status,
        decision: body.action,
        version: 2,
      },
      202,
    );
  }
  if (init?.method === "PATCH" && path.startsWith("conversations/")) {
    return jsonResponse({ ...completedConversation, version: 2 });
  }
  if (init?.method === "POST" && path === "v2/tasks") {
    if (failV2TaskCreate) {
      return jsonResponse({ error: "offline" }, 503);
    }
    return jsonResponse(v2Task);
  }
  if (path.startsWith("v2/tasks/task_missing")) {
    return jsonResponse({ error: "not found" }, 404);
  }
  if (path.startsWith("v2/tasks/task_unavailable")) {
    return jsonResponse({ error: "relay unavailable" }, 503);
  }
  if (init?.method === "POST" && path === "v2/tasks/task_v2_1/messages") {
    return jsonResponse({
      event: {
        event_id: "v2evt_message",
        task_id: "task_v2_1",
        sequence: 3,
        type: "user.message",
        actor: "owner@example.com",
        payload: { message: "Include audit notes" },
        created_at: new Date().toISOString(),
      },
    });
  }
  if (init?.method === "POST" && path === "v2/tasks/task_v2_1/retry") {
    return jsonResponse({ ...v2Task, status: "queued" });
  }
  if (init?.method === "POST" && path === "v2/tasks/task_v2_1/replay") {
    return jsonResponse(v2Replay);
  }
  if (
    init?.method === "POST" &&
    path === "v2/tasks/task_v2_failed/retry-failed"
  ) {
    return jsonResponse({ ...v2FailedTask, status: "queued" }, 202);
  }
  if (
    init?.method === "POST" &&
    path === "v2/tasks/task_v2_failed/accept-partial"
  ) {
    return jsonResponse({ ...v2FailedTask, status: "completed" }, 202);
  }
  if (init?.method === "POST" && path === "v2/tasks/task_v2_legacy/cancel") {
    return jsonResponse({ ...v2FallbackTask, status: "cancelled" });
  }
  if (path === "runs/run_created") {
    return jsonResponse({ ...run, run_id: "run_created", status: "queued" });
  }
  if (path === "runs/run_created/events.json") {
    return jsonResponse({
      events: events.map((item) => ({ ...item, run_id: "run_created" })),
    });
  }
  if (path === "runs/run_created/artifacts") {
    return jsonResponse({ artifacts: [] });
  }
  if (init?.method === "POST" && path === "missions") {
    return jsonResponse({ ...mission, mission_id: "mission_created" });
  }
  if (init?.method === "POST" && path === "profiles") {
    return jsonResponse({
      ...(fixtures.profiles as { profiles: Array<Record<string, unknown>> })
        .profiles[0],
      display_name: "Planner Copy",
      source: "user",
      version: 2,
    });
  }
  if (init?.method === "POST" && path === "access/projects") {
    return jsonResponse({
      project_id: "created",
      display_name: "Created",
      description: "",
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: {},
    });
  }
  if (init?.method === "POST" && path === "access/tokens") {
    return jsonResponse({
      token_id: "token_created",
      name: "operator-token",
      principal_id: "operator",
      project_id: "default",
      scopes: ["runs:*"],
      status: "active",
      token_prefix: "cat_created",
      token: "cat_created_secret",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: {},
    });
  }
  if (init?.method === "POST" && path === "access/tokens/token_1/revoke") {
    return jsonResponse({
      token_id: "token_1",
      name: "operator-token",
      principal_id: "operator",
      scopes: ["runs:*"],
      status: "revoked",
      token_prefix: "cat_test",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      revoked_at: new Date().toISOString(),
      metadata: {},
    });
  }
  if (init?.method === "POST" && path === "auth/users") {
    const body = JSON.parse(String(init.body ?? "{}")) as {
      roles?: string[];
    };
    const created = {
      email: "new@example.com",
      display_name: "new@example.com",
      roles: body.roles ?? ["member"],
      status: "active",
      email_verified_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_login_at: null,
      metadata: {},
    };
    (
      fixtures["auth/users"] as { users: Array<Record<string, unknown>> }
    ).users.push(created);
    return jsonResponse(created);
  }
  const authUserMatch = path.match(
    /^auth\/users\/([^/]+)\/(roles|status|password)$/,
  );
  if (init?.method === "POST" && authUserMatch) {
    const email = decodeURIComponent(authUserMatch[1]);
    const action = authUserMatch[2];
    const body = JSON.parse(String(init.body ?? "{}")) as {
      roles?: string[];
      status?: string;
    };
    const usersFixture = fixtures["auth/users"] as {
      users: Array<Record<string, unknown>>;
    };
    const existing = usersFixture.users.find((item) => item.email === email);
    const updated = {
      ...(existing ?? usersFixture.users[0]),
      email,
      roles: action === "roles" ? body.roles : existing?.roles,
      status: action === "status" ? body.status : existing?.status,
      updated_at: new Date().toISOString(),
    };
    return jsonResponse(updated);
  }
  if (init?.method === "POST" && path === "auth/login") {
    return jsonResponse(fixtures["auth/session"]);
  }
  if (init?.method === "POST" && path === "auth/logout") {
    return jsonResponse({ authenticated: false });
  }
  if (init?.method === "POST" && path === "workers/registrations") {
    return jsonResponse({
      worker_id: "hk-2c2g-b",
      capacity: 1,
      control_url: "https://doubaofans.site/cloud-agents-worker",
      token: {
        token_id: "token_worker",
        name: "worker-hk-2c2g-b",
        principal_id: "operator",
        scopes: ["workers:*"],
        status: "active",
        token_prefix: "cat_worker",
        token: "worker-token-placeholder",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {},
      },
      metadata: {},
      deploy_command: [
        "RUN_WORKER_TOKEN",
        "='<worker-token>' bash scripts/deploy_worker_vps.sh root@<worker-ip> /path/to/key.pem",
      ].join(""),
    });
  }
  if (init?.method === "POST" && path.endsWith("/drain")) {
    const workerFixtures = fixtures.workers as {
      workers: Array<Record<string, unknown>>;
    };
    return jsonResponse({
      worker: { ...workerFixtures.workers[0], status: "draining" },
      control: {},
    });
  }
  if (init?.method === "POST" && path.endsWith("/resume")) {
    const workerFixtures = fixtures.workers as {
      workers: Array<Record<string, unknown>>;
    };
    return jsonResponse({
      worker: { ...workerFixtures.workers[0], status: "active" },
      control: {},
    });
  }
  if (
    init?.method === "POST" &&
    path.includes("/permissions/") &&
    path.endsWith("/notifications/retry")
  ) {
    return jsonResponse(fixtures["runs/run_1/permission-notifications"]);
  }
  if (init?.method === "POST" && path.endsWith("/retry")) {
    return jsonResponse({
      worker_id: "hk-2c2g-a",
      requeued_run_ids: ["run_1"],
      control: {},
    });
  }
  if (init?.method === "POST" && path.endsWith("/input")) {
    return jsonResponse({ accepted: true, run_id: path.split("/")[1] }, 202);
  }
  if (init?.method === "POST" && path.endsWith("/prompt")) {
    const sessionId = path.split("/")[1];
    return jsonResponse(
      { accepted: true, session_id: sessionId, run_id: sessionId },
      202,
    );
  }
  if (init?.method === "POST" && path.includes("/permission/")) {
    return jsonResponse({ accepted: true });
  }
  if (init?.method === "POST" && path.includes("/permissions/")) {
    return jsonResponse({ accepted: true });
  }
  if (init?.method === "POST" && path === "ops/backups") {
    return jsonResponse({
      backup: {
        name: "cloud-agents-backup-new.tar.gz",
        size_bytes: 256,
        created_at: new Date().toISOString(),
      },
    });
  }
  if (init?.method === "POST" && path === "ops/drills") {
    return jsonResponse(fixtures["ops/drills"]);
  }
  return jsonResponse(fixtures[path] ?? {});
}

function jsonResponse(payload: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}
