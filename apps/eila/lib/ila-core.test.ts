import { describe, expect, it } from "vitest";
import { ilaCore } from "@commissioned41/ila-core/core";

describe("EILA core lane boundary", () => {
  it("keeps the client app focused on the customer, not Commissioned 41's private owner lane", () => {
    const prompt = ilaCore("Sam");
    expect(prompt).toContain("CLIENT APP BOUNDARY");
    expect(prompt).not.toContain("Aaron");
    expect(prompt).not.toContain("Aaron Price's right hand");
    expect(prompt).not.toContain("PRIVATE OWNER MISSION");
  });

  it("gives Aaron's owner view the private Commissioned 41 mission", () => {
    const prompt = ilaCore("Aaron", "owner");
    expect(prompt).toContain("PRIVATE OWNER MISSION");
    expect(prompt).toContain("right hand for Commissioned 41");
    expect(prompt).toContain("Aaron is your only business principal");
  });
});
