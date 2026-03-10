import "./run.overflow-compaction.mocks.shared.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils.js", () => ({
  resolveUserPath: vi.fn((p: string) => p),
}));

import { log } from "./logger.js";
import { runEmbeddedPiAgent } from "./run.js";
import { makeAttemptResult } from "./run.overflow-compaction.fixture.js";
import {
  mockedComputeBackoff,
  mockedGetApiKeyForModel,
  mockedRunEmbeddedAttempt,
  mockedSleepWithAbort,
  mockedResolveModel,
} from "./run.overflow-compaction.mocks.shared.js";
import { overflowBaseRunParams as baseParams } from "./run.overflow-compaction.shared-test.js";

describe("runEmbeddedPiAgent Codex OAuth transient server-error retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedComputeBackoff.mockReturnValue(123);
    mockedSleepWithAbort.mockResolvedValue(undefined);
    mockedResolveModel.mockReturnValue({
      model: {
        id: "gpt-5.4",
        provider: "openai-codex",
        contextWindow: 200000,
        api: "openai-codex-responses",
      },
      error: null,
      authStorage: {
        setRuntimeApiKey: vi.fn(),
      },
      modelRegistry: {},
    });
    mockedGetApiKeyForModel.mockResolvedValue({
      apiKey: "oauth-test-key",
      profileId: "codex-profile",
      source: "test",
      mode: "oauth",
    });
  });

  it("retries bounded transient server_error responses for Codex OAuth and then succeeds", async () => {
    mockedRunEmbeddedAttempt
      .mockResolvedValueOnce(
        makeAttemptResult({
          assistantTexts: [],
          lastAssistant: {
            role: "assistant",
            model: "gpt-5.4",
            provider: "openai-codex",
            stopReason: "error",
            errorMessage:
              '{"type":"error","error":{"type":"server_error","code":"server_error","message":"An error occurred while processing your request."}}',
            content: [],
            timestamp: Date.now(),
          },
        }),
      )
      .mockResolvedValueOnce(
        makeAttemptResult({
          assistantTexts: ["ok"],
          lastAssistant: {
            role: "assistant",
            model: "gpt-5.4",
            provider: "openai-codex",
            stopReason: "stop",
            content: [{ type: "text", text: "ok" }],
            timestamp: Date.now(),
          },
        }),
      );

    const result = await runEmbeddedPiAgent(baseParams);

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(2);
    expect(mockedComputeBackoff).toHaveBeenCalledTimes(1);
    expect(mockedSleepWithAbort).toHaveBeenCalledWith(123, undefined);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("codex oauth transient server error; retrying"),
    );
    expect(result.meta.error).toBeUndefined();
  });

  it("does not retry invalid_request errors for Codex OAuth", async () => {
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(
      makeAttemptResult({
        assistantTexts: [],
        lastAssistant: {
          role: "assistant",
          model: "gpt-5.4",
          provider: "openai-codex",
          stopReason: "error",
          errorMessage:
            '{"type":"error","error":{"type":"invalid_request_error","message":"Bad input."}}',
          content: [],
          timestamp: Date.now(),
        },
      }),
    );

    const result = await runEmbeddedPiAgent(baseParams);

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(1);
    expect(mockedComputeBackoff).not.toHaveBeenCalled();
    expect(mockedSleepWithAbort).not.toHaveBeenCalled();
    expect(result.meta.error).toBeUndefined();
  });

  it("stops after the bounded retry count and returns friendly copy", async () => {
    const errorMessage =
      '{"type":"error","error":{"type":"server_error","code":"server_error","message":"Still broken."}}';

    mockedRunEmbeddedAttempt.mockResolvedValue(
      makeAttemptResult({
        assistantTexts: [],
        lastAssistant: {
          role: "assistant",
          model: "gpt-5.4",
          provider: "openai-codex",
          stopReason: "error",
          errorMessage,
          content: [],
          timestamp: Date.now(),
        },
      }),
    );

    const result = await runEmbeddedPiAgent(baseParams);

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(4);
    expect(mockedComputeBackoff).toHaveBeenCalledTimes(3);
    expect(mockedSleepWithAbort).toHaveBeenCalledTimes(3);
    expect(result.meta.error).toBeUndefined();
  });
});
