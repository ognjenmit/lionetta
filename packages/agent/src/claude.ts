import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import type { AgentInput, DiscoveredTool } from "../../shared/src/index.js";

export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";
export interface ClaudeToolResult { data: Record<string, unknown>; isError?: boolean; stop?: boolean }

/** Native Anthropic tool_use/tool_result protocol. Histories keep complete turns, including source results. */
export class ClaudeAdapter {
  private readonly client: Anthropic;
  private readonly history = new Map<string, MessageParam[][]>();
  constructor(apiKey: string, private readonly model = DEFAULT_CLAUDE_MODEL, baseURL?: string) {
    this.client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}), timeout: 55_000, maxRetries: 0 });
  }

  async invoke(input: AgentInput, system: string, tools: DiscoveredTool[],
    execute: (tool: DiscoveredTool, args: Record<string, unknown>) => Promise<ClaudeToolResult>): Promise<string> {
    const names = new Map<string, DiscoveredTool>();
    const definitions: Tool[] = tools.map((tool, index) => {
      const name = `mcp_${index}_${tool.name.replace(/[^\w-]/g, "_")}`.slice(0, 64);
      names.set(name, tool);
      return { name, description: tool.description + (tool.requiresConfirmation ? " Host confirmation is required." : ""),
        input_schema: { ...tool.inputSchema, type: "object" } };
    });
    const turn: MessageParam[] = [{ role: "user", content: input.prompt }];
    const messages: MessageParam[] = [...(this.history.get(this.key(input)) ?? []).flat(), ...turn];
    const signal = AbortSignal.timeout(55_000);
    let count = 0;
    const finish = (reply: string) => {
      turn.push({ role: "assistant", content: reply }); this.store(input, turn); return reply;
    };
    for (let round = 0; round < 8; round++) {
      const message = await this.client.messages.create({ model: this.model, max_tokens: 2048,
        system, messages, ...(definitions.length ? { tools: definitions } : {}) }, { signal });
      const calls = message.content.filter(block => block.type === "tool_use");
      if (!calls.length) {
        const reply = message.content.filter(block => block.type === "text").map(block => block.text).join("\n").trim();
        return finish(reply || "Please describe what you would like to explore.");
      }
      const assistant: MessageParam = { role: "assistant", content: message.content };
      turn.push(assistant); messages.push(assistant);
      const results: ToolResultBlockParam[] = [];
      let stopped = false;
      for (const call of calls) {
        const tool = names.get(call.name);
        let result: ClaudeToolResult;
        if (stopped || count >= 16) result = { data: { error: "Tool execution paused. Wait for the user's next request or confirmation." }, isError: true };
        else if (!tool) result = { data: { error: "This tool is not available to this tenant." }, isError: true };
        else if (typeof call.input !== "object" || call.input === null || Array.isArray(call.input)) result = { data: { error: "Tool arguments must be a JSON object." }, isError: true };
        else { count++; result = await execute(tool, call.input as Record<string, unknown>); }
        results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result.data), ...(result.isError ? { is_error: true } : {}) });
        stopped ||= result.stop ?? false;
      }
      const toolResults: MessageParam = { role: "user", content: results };
      turn.push(toolResults); messages.push(toolResults);
      if (stopped) return finish("The proposed action is waiting for your confirmation. It has not run yet.");
      if (count >= 16) break;
    }
    return finish("Claude reached the tool limit for this request. Please narrow your question and try again.");
  }

  rememberDirect(input: AgentInput, reply: string): void {
    this.store(input, [{ role: "user", content: input.prompt }, { role: "assistant", content: reply }]);
  }
  clear(): void { this.history.clear(); }
  private key(input: AgentInput): string { return JSON.stringify([input.tenantId, input.sessionId]); }
  private store(input: AgentInput, turn: MessageParam[]): void {
    const key = this.key(input); const turns = [...(this.history.get(key) ?? []), turn].slice(-8);
    this.history.delete(key); this.history.set(key, turns);
    if (this.history.size > 1000) this.history.delete(this.history.keys().next().value!);
  }
}
