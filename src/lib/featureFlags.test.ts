import { afterEach, describe, expect, it } from "vitest";
import { experimentalSurfacesEnabled, voiceInputEnabled } from "./featureFlags";

const FLAG = "NEXT_PUBLIC_EXPERIMENTAL_SURFACES";

describe("experimentalSurfacesEnabled", () => {
  const previous = process.env[FLAG];

  afterEach(() => {
    if (previous === undefined) delete process.env[FLAG];
    else process.env[FLAG] = previous;
  });

  it("defaults to off when the flag is unset", () => {
    delete process.env[FLAG];
    expect(experimentalSurfacesEnabled()).toBe(false);
  });

  it("turns on only for an exact \"1\"", () => {
    process.env[FLAG] = "1";
    expect(experimentalSurfacesEnabled()).toBe(true);
  });

  it("treats any other value as off", () => {
    for (const value of ["", "0", "true", "on", " 1", "1 "]) {
      process.env[FLAG] = value;
      expect(experimentalSurfacesEnabled()).toBe(false);
    }
  });
});

describe("voiceInputEnabled", () => {
  const VOICE = "NEXT_PUBLIC_VOICE_INPUT";
  const previous = process.env[VOICE];

  afterEach(() => {
    if (previous === undefined) delete process.env[VOICE];
    else process.env[VOICE] = previous;
  });

  it("is on by default and off only for an exact \"0\"", () => {
    delete process.env[VOICE];
    expect(voiceInputEnabled()).toBe(true);
    for (const value of ["", "1", "true", " 0"]) {
      process.env[VOICE] = value;
      expect(voiceInputEnabled()).toBe(true);
    }
    process.env[VOICE] = "0";
    expect(voiceInputEnabled()).toBe(false);
  });

  it("does not depend on the experimental-surfaces flag", () => {
    delete process.env.NEXT_PUBLIC_EXPERIMENTAL_SURFACES;
    delete process.env[VOICE];
    expect(experimentalSurfacesEnabled()).toBe(false);
    expect(voiceInputEnabled()).toBe(true);
  });
});
