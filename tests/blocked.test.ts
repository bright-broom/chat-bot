import { describe, expect, it } from "vitest";
import { BLOCKED_TOPIC_RULE, mentionsBlockedTopic } from "@/lib/chat/blocked";

describe("回答しない話題", () => {
  it("既定では何もブロックしない", () => {
    expect(mentionsBlockedTopic("住民票の取り方")).toBe(false);
    expect(BLOCKED_TOPIC_RULE).toBe("");
  });
});
