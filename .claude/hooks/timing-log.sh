#!/bin/sh
# Appends one JSONL event per tracked tool call (pre + post) to .claude/telemetry/tool-events.jsonl.
# Paired by tool_use_id in scripts/agent-timing-report.ts to compute durations per
# skill / subagent / gate command. Input: hook JSON on stdin (Claude Code hooks contract).
phase="$1"
dir="${CLAUDE_PROJECT_DIR:-.}/.claude/telemetry"
mkdir -p "$dir"
jq -c \
    --arg phase "$phase" \
    --argjson ts "$(date +%s)" \
    '{
        ts: $ts,
        phase: $phase,
        event: .hook_event_name,
        session: .session_id,
        tool: (.tool_name // null),
        id: (.tool_use_id // null),
        skill: (.tool_input.skill // null),
        agent_desc: (.tool_input.description // null),
        agent_type: (.tool_input.subagent_type // null),
        model: (.tool_input.model // null),
        cmd: ((.tool_input.command // null) | if . then .[0:160] else null end),
        bg: (.tool_input.run_in_background // null),
        tokens: (.tool_response.totalTokens // .tool_response.usage.output_tokens // null)
    }' >>"$dir/tool-events.jsonl" 2>/dev/null
exit 0
