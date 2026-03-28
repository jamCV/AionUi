# Design: Codex Weixin File Delivery

**Date:** 2026-03-26
**Status:** Draft Approved
**Scope:** `Codex` in Weixin conversations can send generated local files back to the current Weixin user when the user explicitly requests file delivery.
**Primary Path:** Reuse `openclaw-weixin` outbound file/media delivery capability instead of extending the current built-in text-only Weixin bridge.

---

## Overview

AionUi currently supports Weixin conversations with Codex, but the active in-repo Weixin channel bridge is text-only and cannot deliver generated files back to the user. At the same time, a separate `openclaw-weixin` runtime integration already contains a working outbound media/file send path.

This design defines a phased implementation to let Codex send generated local files to the current Weixin user only when the user explicitly asks for that behavior in natural language. The feature must be safe, traceable, phase-gated, and test-gated. No later phase may start until the previous phase passes its defined tests.

This document is intended to be the single source of truth for:

1. The problem background and why the current behavior is insufficient.
2. The chosen implementation path and why alternatives were rejected.
3. The exact phased rollout plan, including test gates and exit criteria.
4. The current implementation status, so future agents can resume work without drifting.

---

## Background

### User Problem

In a Weixin conversation, Codex can generate files inside the local workspace, but it cannot currently send those files back to the user through Weixin. This breaks the user workflow for tasks like:

- "Generate a report and send it to me on Weixin."
- "Create the PDF and send the document back."
- "Export the result and deliver the file to this chat."

The user wants:

1. Codex to understand file-delivery intent from natural language.
2. Codex to send the generated file back to the same Weixin user in the current chat.
3. The implementation to be phased, test-gated, and documented so future agents can continue without losing context.

### Current Technical State

The in-repo built-in Weixin channel is still text-only:

- [WeixinAdapter.ts](/E:/GithubProj/AionUi/src/process/channels/plugins/weixin/WeixinAdapter.ts#L14)
- [WeixinPlugin.ts](/E:/GithubProj/AionUi/src/process/channels/plugins/weixin/WeixinPlugin.ts)

The current channel-to-agent bridge sends only text content into Codex:

- [ChannelMessageService.ts](/E:/GithubProj/AionUi/src/process/channels/agent/ChannelMessageService.ts#L213)

However, the runtime `openclaw-weixin` plugin already has outbound media/file delivery support, including local file upload and send:

- [send-media.ts](C:/Users/jam/AppData/Roaming/AionUi/aionui/codex-temp-1774456119934/pkg_unpack_plugin_201/package/src/messaging/send-media.ts#L17)
- [send-media.ts](C:/Users/jam/AppData/Roaming/AionUi/aionui/codex-temp-1774456119934/pkg_unpack_plugin_201/package/src/messaging/send-media.ts#L56)

This means the lowest-level "send a local file to Weixin" capability already exists, but AionUi does not yet expose it as a safe, Codex-usable capability in the current Weixin conversation pipeline.

---

## Goal

Enable Codex, inside a Weixin conversation, to send a generated local file back to the current Weixin user when and only when the user explicitly expresses file-delivery intent in natural language.

### Success Criteria

1. A Weixin user can ask Codex to generate a file and send it back in the same chat.
2. Codex can access a delivery mechanism that targets only the current Weixin conversation user.
3. The feature works for common file types such as `txt`, `md`, `pdf`, `png`, and `zip`.
4. Delivery attempts are logged and auditable.
5. Each implementation phase has required tests and a pass gate before the next phase can begin.

### Non-Goals

1. Do not support arbitrary recipient selection in v1.
2. Do not enable automatic file sending when the user only asked to generate a file.
3. Do not replace the entire built-in Weixin channel implementation in v1.
4. Do not rely on a skill alone as the transport mechanism.
5. Do not implement general-purpose natural-language routing across all channels in v1.

---

## Confirmed Product Decisions

The following decisions were explicitly confirmed before writing this document:

1. **Chosen base path:** reuse `openclaw-weixin` delivery capability.
2. **User interaction rule:** send only when the user explicitly requests sending.
3. **Intent mode:** natural-language intent recognition, not only fixed command phrases.

These are frozen for v1 unless the user changes scope in a later planning round.

---

## Why This Approach

### Recommended Approach

Add a dedicated AionUi-side Weixin file delivery capability that reuses `openclaw-weixin` outbound delivery, then expose that capability to Codex through a narrow, channel-aware tool/action bound to the current Weixin conversation.

This approach is preferred because:

1. It reuses an already-working outbound file transport path.
2. It avoids a full rewrite of the current built-in Weixin bridge.
3. It gives Codex a controlled capability instead of broad transport access.
4. It creates clear boundaries between:
   - intent detection,
   - tool exposure,
   - delivery execution,
   - audit logging.

### Rejected Alternatives

#### Alternative A: Extend the built-in Weixin plugin directly as the primary path

Rejected for v1 because the built-in plugin is currently designed as a text-only promise bridge. Adding media/file outbound support there would require broader changes to the channel bridge shape and would not reuse the already-working `openclaw-weixin` file send path.

#### Alternative B: Solve it with a skill only

Rejected because a skill can influence agent behavior, but cannot create transport capabilities that do not exist in the runtime. The transport must be implemented in the backend/tool layer first.

#### Alternative C: Add a fully generic cross-channel file-send tool first

Rejected for v1 because it broadens scope too early. The user requirement is specifically current-Weixin-user delivery. A narrower Weixin-only tool is safer and faster.

---

## Functional Requirements

### FR-1 Current Conversation Delivery

Codex must be able to send a local file only to the current Weixin conversation user. The user target must be derived from the active Weixin session context, not from arbitrary free-form model output.

### FR-2 Local File Path Support

The delivery path must accept a local absolute file path produced by Codex or other tools during the conversation.

### FR-3 Explicit Intent Required

Codex may only trigger file delivery when the current user message contains explicit file-delivery intent, expressed in natural language.

Examples of allowed intent:

- "生成后发给我"
- "把文档发到微信给我"
- "做好以后把文件传回来"
- "导出 pdf 然后发我"

Examples that must not auto-send:

- "帮我生成一份报告"
- "导出一个 pdf"
- "保存到本地就行"

### FR-4 Safe Failure Behavior

If delivery fails, the conversation must not silently fail. Codex should receive a clear failure result and reply with a useful explanation.

### FR-5 Auditable Execution

Each delivery attempt must record enough metadata for debugging and auditing, including:

- conversation id
- channel/platform
- current Weixin target id
- file path
- file type
- timestamp
- success/failure
- failure reason when applicable

### FR-6 Phase-Gated Delivery Rollout

Implementation must be phased. Each phase must define mandatory tests and a pass condition. Work on the next phase is blocked until the current phase passes.

---

## Non-Functional Requirements

### NFR-1 Safety

The file-send capability must not let Codex choose an arbitrary recipient in v1.

### NFR-2 Determinism

The delivery tool contract must be narrow and deterministic. The model should provide the file path and optional caption, but user resolution and account resolution should come from runtime context.

### NFR-3 Debuggability

Failures must be diagnosable through logs without attaching a debugger.

### NFR-4 Resumability

A future agent must be able to read this document and immediately know:

1. why the feature exists,
2. what architecture was chosen,
3. what remains to be built,
4. which tests define done-ness,
5. what current status each phase is in.

---

## Current Architecture Constraints

### Constraint 1: Built-In Weixin Bridge Is Text-Only

The current in-repo Weixin adapter explicitly documents text-only behavior:

- [WeixinAdapter.ts](/E:/GithubProj/AionUi/src/process/channels/plugins/weixin/WeixinAdapter.ts#L14)

This means v1 should not try to "teach" the current bridge to carry arbitrary media payloads end-to-end before a narrower delivery path exists.

### Constraint 2: ChannelMessageService Only Passes Text to Codex

The current channel message bridge builds a text payload for Codex:

- [ChannelMessageService.ts](/E:/GithubProj/AionUi/src/process/channels/agent/ChannelMessageService.ts#L213)

This means the file-delivery capability should be added as a tool/action callable from Codex, not as an implicit extension of the plain conversation message payload.

### Constraint 3: Runtime Has a Working Weixin File Send Path

The `openclaw-weixin` runtime includes a proper local-file upload and send flow:

- [send-media.ts](C:/Users/jam/AppData/Roaming/AionUi/aionui/codex-temp-1774456119934/pkg_unpack_plugin_201/package/src/messaging/send-media.ts#L17)

This should be treated as the authoritative transport implementation to reuse.

---

## Proposed Architecture

## High-Level Shape

The feature will be implemented as four layers:

1. **Intent Gate**
   Determines whether the current user message explicitly requests file delivery.

2. **Codex Tool Exposure**
   Exposes a narrow capability to Codex, only in eligible Weixin conversation contexts.

3. **Weixin File Delivery Service**
   A backend service in AionUi that validates inputs, resolves current Weixin context, and delegates to reused `openclaw-weixin` send logic.

4. **Audit and Status Layer**
   Records delivery attempts and returns structured success/failure results.

### Target Data Flow

```
[Weixin user message]
  -> built-in Weixin channel
  -> ChannelMessageService
  -> Codex conversation
  -> Codex determines:
       "user explicitly wants file sent"
  -> Codex calls channel-aware file delivery tool
  -> WeixinFileDeliveryService
       -> validate absolute local file path
       -> resolve current Weixin recipient from conversation context
       -> resolve correct Weixin account/runtime binding
       -> delegate to openclaw-weixin outbound file send
  -> structured result returned to Codex
  -> Codex confirms success/failure in chat
```

---

## Component Design

### Component A: `WeixinFileDeliveryService`

New backend service responsible for executing actual Weixin file delivery.

#### Responsibilities

1. Validate the input file path.
2. Ensure the path is absolute.
3. Ensure the file exists and is a regular file.
4. Resolve the current Weixin recipient from active conversation context.
5. Resolve the correct sender account/runtime binding.
6. Delegate sending to the reused `openclaw-weixin` outbound path.
7. Return structured success/failure.
8. Emit audit logs.

#### Non-Responsibilities

1. It does not do natural-language understanding.
2. It does not let the model freely choose recipients.
3. It does not decide whether sending is allowed by policy beyond runtime validation.

#### Suggested API Shape

```typescript
interface SendFileToCurrentWeixinUserParams {
  conversationId: string;
  filePath: string;
  caption?: string;
}

interface SendFileToCurrentWeixinUserResult {
  success: boolean;
  channel: 'weixin';
  deliveredTo?: string;
  accountId?: string;
  messageId?: string;
  errorCode?: string;
  errorMessage?: string;
}
```

### Component B: Codex Tool Exposure

Expose a narrow tool to Codex, visible only when the conversation source/platform is Weixin.

#### Recommended Tool Contract

```text
send_file_to_current_weixin_user(
  file_path: string,
  caption?: string
)
```

#### Guardrails

1. Must only be available in Weixin conversations.
2. Must only target the current conversation user.
3. Must require an absolute path.
4. Must fail with explicit structured errors.

### Component C: Intent Gate

Natural-language gating should happen before or during tool use planning.

#### Required Rule

The tool may be used only when the current user turn clearly indicates a request to send or deliver the file back to the user.

#### Design Rule

This should be implemented as a conservative gate, biased toward false negatives over false positives in v1.

### Component D: Delivery Audit Log

Every send attempt must generate a structured log entry.

Suggested fields:

```typescript
{
  feature: 'codex_weixin_file_delivery',
  conversationId,
  source: 'weixin',
  targetUserId,
  accountId,
  filePath,
  mimeType,
  success,
  errorCode,
  errorMessage,
  timestamp,
}
```

---

## Phased Implementation Plan

No phase may begin implementation until the previous phase's tests have passed.

### Phase 0: Design Freeze And Baseline Capture

**Purpose**

Freeze the approved scope, architecture, and test gates before coding.

**Required Outputs**

1. This design document exists locally.
2. This design document is synced to Yuque.
3. Current implementation status is captured.
4. Follow-up implementation must reference this document.

**Tests / Validation**

1. Local file exists at the agreed spec path.
2. Yuque doc exists in the target knowledge base.
3. The document includes:
   - background
   - goals
   - non-goals
   - chosen architecture
   - phases
   - test gates
   - current status table

**Exit Criteria**

Phase 0 passes when the document is written, locally persisted, remotely persisted, and reviewed by the user.

### Phase 1: Backend Delivery Capability

**Purpose**

Build a backend `WeixinFileDeliveryService` that can send a local file to the current Weixin user by reusing `openclaw-weixin` outbound media/file capability.

**Required Outputs**

1. New service module implemented.
2. Runtime resolution for current Weixin conversation context implemented.
3. Reuse path to `openclaw-weixin` outbound send path implemented.
4. Structured result and audit log shape implemented.

**Required Tests**

1. Unit test: rejects non-absolute file path.
2. Unit test: rejects missing file.
3. Unit test: rejects non-file path.
4. Unit test: resolves current Weixin target from conversation context.
5. Unit test: returns structured error when no Weixin runtime/account can be resolved.
6. Integration test: sends a local file through the reused outbound path with mocked transport.
7. Manual verification: at least one real local file can be sent to the current Weixin user in a controlled environment.

**Exit Criteria**

Phase 1 passes only when all automated tests pass and the real-file manual verification succeeds.

### Phase 2: Codex Tool Wiring

**Purpose**

Expose the delivery capability to Codex as a narrow, channel-aware tool.

**Required Outputs**

1. Tool registration or equivalent capability exposure implemented.
2. Tool visible only in Weixin conversations.
3. Tool bound to current conversation context.
4. Tool calls the Phase 1 backend service.

**Required Tests**

1. Unit test: tool unavailable outside Weixin conversations.
2. Unit test: tool invocation validates absolute path requirement.
3. Unit test: successful tool call returns structured success payload.
4. Unit test: failed tool call returns structured failure payload.
5. Manual end-to-end test:
   - user asks Codex to generate file and send it,
   - Codex produces file,
   - Codex calls tool,
   - user receives file in Weixin,
   - Codex confirms success.

**Exit Criteria**

Phase 2 passes only when Codex can successfully trigger file delivery in a real Weixin conversation and all scoped tests pass.

### Phase 3: Explicit Intent Gate

**Purpose**

Allow tool usage only when the user's current message explicitly requests sending the file back.

**Required Outputs**

1. Conservative natural-language intent rule added.
2. Prompt/tool guidance updated so Codex uses the tool only under explicit-send intent.
3. Negative-path behavior defined for "generate only" requests.

**Required Tests**

1. Positive intent examples trigger tool eligibility.
2. Negative intent examples do not trigger tool eligibility.
3. Borderline ambiguous requests default to not sending.
4. Manual test:
   - "生成报告" does not send automatically.
   - "生成报告并发给我" does send.

**Exit Criteria**

Phase 3 passes only when positive and negative intent behavior matches design and manual checks confirm the model does not over-send.

### Phase 4: Hardening, Observability, And Recovery

**Purpose**

Make the feature production-safe and maintainable.

**Required Outputs**

1. Audit log completeness verified.
2. Failure taxonomy stabilized.
3. User-facing fallback messaging improved.
4. Repeated-send and duplicate-send edge cases evaluated.

**Required Tests**

1. Delivery failure logs include enough context to debug.
2. Tool/network/runtime failure returns useful structured error.
3. Duplicate invocation handling tested.
4. Manual failure injection:
   - missing file
   - unavailable sender account
   - transport failure

**Exit Criteria**

Phase 4 passes only when failures are observable, recoverable, and do not silently degrade the conversation experience.

---

## Testing Strategy Summary

The project must follow this order:

1. Write or update tests for the current phase.
2. Implement the phase.
3. Run automated tests for the phase.
4. Run required manual verification for the phase.
5. Mark phase complete only after both automated and manual checks pass.
6. Move to the next phase.

### Mandatory Rule

If a phase fails testing, implementation must stop and be corrected before starting the next phase.

---

## Risks

### Risk 1: Context Resolution Drift

The AionUi built-in Weixin conversation context and the reused `openclaw-weixin` runtime context may not align cleanly. This can cause delivery to fail or resolve the wrong sender/runtime.

**Mitigation**

Build explicit mapping logic and test it with real conversation/session data.

### Risk 2: Over-Sending Due To Loose Intent Recognition

Natural-language gating can misclassify "generate" as "generate and send".

**Mitigation**

Use a conservative rule set in v1 and bias toward not sending unless explicit delivery intent is present.

### Risk 3: Runtime Coupling To Temporary Or Unstable Paths

The currently inspected `openclaw-weixin` source was found in runtime unpacked paths, which may not be stable integration boundaries.

**Mitigation**

During implementation, identify and bind to the stable runtime abstraction rather than hard-coding temp unpack locations.

### Risk 4: Hidden Audit Gaps

Without structured logging, later agents may not know whether failures are due to intent, context, tool exposure, or transport.

**Mitigation**

Add explicit structured audit logs in Phase 1 and verify them in Phase 4.

---

## Open Questions

These are intentionally deferred, not blockers for v1:

1. Should captions be plain text only, or support limited formatting?
2. Should v2 allow sending multiple files in one request?
3. Should delivery attempts surface in the AionUi UI as a first-class activity event?
4. Should the final tool be Weixin-only or later abstracted into a generic channel delivery capability?

---

## Current Implementation Status

This section must be updated after each completed phase.

| Item | Status | Notes |
| --- | --- | --- |
| Phase 0 design doc | Completed | English spec written locally and synced remotely on 2026-03-26 |
| Phase 1 backend delivery service | Not Started | No AionUi-native reusable service exists yet |
| Phase 2 Codex tool wiring | Not Started | No current Weixin-only delivery tool exposed to Codex |
| Phase 3 intent gate | Not Started | Natural-language explicit-send gate not implemented |
| Phase 4 hardening | Not Started | Audit/recovery not implemented |
| Built-in Weixin bridge supports files | No | Current in-repo bridge is text-only |
| Reusable runtime file-send path exists | Yes | Present in `openclaw-weixin` runtime integration |

### Known Implementation Facts As Of 2026-03-26

1. The in-repo built-in Weixin bridge is text-only.
2. Channel-to-Codex message flow is text-only.
3. A reusable runtime file-send path exists in `openclaw-weixin`.
4. No user-approved plan exists yet for arbitrary recipient delivery.
5. v1 scope is strictly "send to current Weixin user only on explicit request."

---

## Implementation Guidance For Future Agents

When continuing this work:

1. Read this document first.
2. Verify whether the current phase status table is still accurate.
3. Do not skip test gates.
4. Do not broaden scope to arbitrary recipient delivery without explicit approval.
5. Do not replace the current built-in Weixin bridge as part of v1 unless blocked and re-approved.
6. Reuse the stable `openclaw-weixin` outbound delivery path where possible.
7. Update the "Current Implementation Status" section after each completed phase.

---

## Recommended Next Step

The next implementation session should create a written implementation plan for **Phase 1 only** based on this document, including:

1. exact modules to add or modify,
2. stable runtime integration boundary for `openclaw-weixin`,
3. test list,
4. manual verification procedure,
5. rollback considerations.
