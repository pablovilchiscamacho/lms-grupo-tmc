import { describe, expect, it } from "vitest";
import { fmtDate } from "./format";

describe("fmtDate", () => {
  it("una fecha sin hora no se recorre un día por la zona horaria", () => {
    expect(fmtDate("2024-03-01")).toBe("01/03/2024");
  });
  it("un timestamp se muestra en la hora de Ciudad de México", () => {
    expect(fmtDate("2026-10-08T03:00:00Z")).toBe("07/10/2026");
  });
});
