import { afterEach, describe, expect, it } from "vitest";
import { experimentalSurfacesEnabled } from "./featureFlags";

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
