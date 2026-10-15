/**
 * The provider path must not load Claude Code's settings.json sources: pi owns
 * permissions, hooks and safety checks there, and user/project/local settings
 * would add Claude Code's permission rules, auto-mode classifier and hooks on
 * top. The inline settings the bridge passes still reach CC.
 */
import { after, before, it } from "node:test";
import assert from "node:assert/strict";

const { default: activate, __test } = await import("../src/index.js");

let calls = [];

function fakeQuery({ options }) {
	calls.push(options);
	const messages = [{
		type: "result", subtype: "success", is_error: false, result: "ok",
		usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
		modelUsage: {},
	}];
	return {
		async *[Symbol.asyncIterator]() { yield* messages; },
		interrupt: async () => {},
		close: () => {},
	};
}

before(() => {
	activate({ on: () => {}, registerProvider: () => {}, registerTool: () => {} });
	__test.setQuery(fakeQuery);
});

after(() => {
	__test.setQuery(null);
	__test.resetSharedSession();
});

it("provider spawn loads no setting sources and keeps its inline settings", async () => {
	calls = [];
	__test.resetSharedSession();
	const model = { id: "claude-opus-5-5", name: "claude-opus-5-5", api: "claude-bridge", provider: "claude-bridge", contextWindow: 1000000, maxTokens: 128000, reasoning: true };
	const stream = __test.streamClaudeAgentSdk(model, {
		messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
	});
	assert.equal(calls.length, 1, `expected one query() call, got ${calls.length}`);
	assert.deepEqual(calls[0].settingSources, []);
	assert.equal(calls[0].permissionMode, "bypassPermissions");
	assert.equal(calls[0].settings.includeGitInstructions, false);
	for await (const event of stream) if (event.type === "done" || event.type === "error") break;
});
