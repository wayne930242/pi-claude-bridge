// A custom section deleted and re-added lands at the end of pi-ai's replay Map, while
// pi's builder (and so the capture key) renders customs in `systemPromptOptions.sections`
// order. canonicalSystemPrompt only re-ranks built-ins, so the replayed prompt differs from
// the recorded key in nothing but the relative order of the custom blocks, and every later
// turn threw "no capture ... embeds none of the N known".
//
// The transcript here is built with pi's own builder and diff, and replayed through the real
// pi-ai getCurrentSystemMessage via toBridgeContext. Section names and contents are synthetic.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { PromptCaptures } from "../src/prompt-capture.js";
import { __test } from "../src/index.js";

const { toBridgeContext } = __test;

const PI_SYSTEM_PROMPT = fileURLToPath(new URL("../node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js", import.meta.url));
const { buildSystemPrompt, buildSystemPromptSections, diffSystemPromptSections } = await import(PI_SYSTEM_PROMPT);

const ALPHA = "alpha rules\nsecond line";
const BETA = "beta rules";
const GAMMA = "gamma rules";

function userMessage(text) {
	return { role: "user", content: [{ type: "text", text }], timestamp: 0 };
}

function systemMessage(overrides) {
	return { role: "system", content: "", timestamp: 0, ...overrides };
}

function buildInput(sections) {
	return { cwd: "/w", sections };
}

/** pi persists the first render whole, then one diff patch per later change. */
function transcript(...renders) {
	const messages = [];
	let current = {};
	for (const sections of renders) {
		const next = buildSystemPromptSections(buildInput(sections));
		const patch = diffSystemPromptSections(current, next);
		if (patch) messages.push(systemMessage({ sections: patch }));
		current = next;
	}
	return [...messages, userMessage("go")];
}

function replayed(messages) {
	return toBridgeContext({ messages, tools: undefined, systemPrompt: undefined }).systemPrompt;
}

function recordFromBuilder(captures, sections, overrides = {}) {
	const key = buildSystemPrompt(buildInput(sections));
	captures.record(key, { contextFiles: [], skills: [], sections, ...overrides }, "turn_start");
	return key;
}

describe("custom section order across delete-then-re-add", () => {
	// alpha and beta rendered; alpha vanishes for one turn, then returns.
	const REORDERED = transcript(
		{ alpha: ALPHA, beta: BETA },
		{ beta: BETA },
		{ alpha: ALPHA, beta: BETA },
	);

	it("the replay really differs from the builder only in custom order", () => {
		const key = buildSystemPrompt(buildInput({ alpha: ALPHA, beta: BETA }));
		const prompt = replayed(REORDERED);
		assert.notEqual(prompt, key);
		assert.equal(prompt.length, key.length);
		assert.ok(prompt.indexOf("<beta>") < prompt.indexOf("<alpha>"));
		assert.ok(key.indexOf("<alpha>") < key.indexOf("<beta>"));
	});

	it("resolves to the capture recorded from the builder order", () => {
		const captures = new PromptCaptures();
		const key = recordFromBuilder(captures, { alpha: ALPHA, beta: BETA });
		const found = captures.resolveOrDerive(replayed(REORDERED));
		assert.equal(found, captures.resolve(key));
		assert.deepEqual(Object.keys(found.sections), ["alpha", "beta"]);
	});

	it("resolves a three-section rotation", () => {
		const captures = new PromptCaptures();
		const key = recordFromBuilder(captures, { alpha: ALPHA, beta: BETA, gamma: GAMMA });
		const messages = transcript(
			{ alpha: ALPHA, beta: BETA, gamma: GAMMA },
			{ beta: BETA, gamma: GAMMA },
			{ alpha: ALPHA, beta: BETA, gamma: GAMMA },
		);
		assert.ok(replayed(messages).indexOf("<alpha>") > replayed(messages).indexOf("<gamma>"));
		assert.equal(captures.resolveOrDerive(replayed(messages)), captures.resolve(key));
	});

	it("does not re-key the capture under the reordered prompt", () => {
		const captures = new PromptCaptures();
		recordFromBuilder(captures, { alpha: ALPHA, beta: BETA });
		const before = captures.size;
		captures.resolveOrDerive(replayed(REORDERED));
		assert.equal(captures.size, before);
		assert.equal(captures.resolve(replayed(REORDERED)), undefined);
	});

	it("still throws when a custom section's content changed", () => {
		const captures = new PromptCaptures();
		recordFromBuilder(captures, { alpha: ALPHA, beta: BETA });
		const messages = transcript(
			{ alpha: ALPHA, beta: BETA },
			{ beta: BETA },
			{ alpha: "ALPHA rules\nsecond line", beta: BETA },
		);
		assert.throws(() => captures.resolveOrDerive(replayed(messages)), /no capture for this/);
	});

	it("still throws when a custom section is missing", () => {
		const captures = new PromptCaptures();
		recordFromBuilder(captures, { alpha: ALPHA, beta: BETA });
		const messages = transcript({ alpha: ALPHA, beta: BETA }, { beta: BETA });
		assert.throws(() => captures.resolveOrDerive(replayed(messages)), /no capture for this/);
	});

	it("still throws when a custom section is extra", () => {
		const captures = new PromptCaptures();
		recordFromBuilder(captures, { alpha: ALPHA, beta: BETA });
		const messages = transcript(
			{ alpha: ALPHA, beta: BETA },
			{ beta: BETA },
			{ alpha: ALPHA, beta: BETA, gamma: GAMMA },
		);
		assert.throws(() => captures.resolveOrDerive(replayed(messages)), /no capture for this/);
	});

	it("still throws when the text before the custom sections differs", () => {
		const captures = new PromptCaptures();
		recordFromBuilder(captures, { alpha: ALPHA, beta: BETA });
		// Same custom blocks, reordered, but the built-in cwd line changed (same length, so only the prefix check can reject it).
		const other = buildSystemPromptSections({ cwd: "/x", sections: { beta: BETA, alpha: ALPHA } });
		const messages = [systemMessage({ sections: other }), userMessage("go")];
		assert.throws(() => captures.resolveOrDerive(replayed(messages)), /no capture for this/);
	});

	it("still throws when the capture has a single custom section to reorder", () => {
		const captures = new PromptCaptures();
		recordFromBuilder(captures, { alpha: ALPHA });
		assert.throws(() => captures.resolveOrDerive(replayed(REORDERED)), /no capture for this/);
	});

	it("keeps the inheritance route ahead of the reorder route", () => {
		const captures = new PromptCaptures();
		const key = recordFromBuilder(captures, { alpha: ALPHA, beta: BETA });
		// A sub-agent embedding the parent's prompt verbatim must still derive a descendant that
		// carries the child's wrapper text, never adopt the parent's capture.
		const child = `${key}\n\nchild wrapper text`;
		captures.record(child, { custom: child, contextFiles: [], skills: [] }, "turn_start");
		const derived = captures.resolveOrDerive(`${key}\n\nanother wrapper`);
		assert.notEqual(derived, captures.resolve(key));
		assert.equal(derived.custom, `${key}\n\nanother wrapper`);
	});
});
