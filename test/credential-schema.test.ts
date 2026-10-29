import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const schema = JSON.parse(readFileSync(new URL("../axi-credential.schema.json", import.meta.url), "utf8"));

test.each(Object.entries(schema.properties) as [string, { title?: string; description?: string }][])(
  "exported credential schema provides a title and description for %s",
  (_name, property) => {
    expect(property.title).toEqual(expect.stringMatching(/\S/));
    expect(property.description).toEqual(expect.stringMatching(/\S/));
  },
);

test.each([
  ["host", schema.properties.host.pattern, "example.pm.beyondtrustcloud.com"],
  ["SecretRef environment name", schema.$defs.secretRef.oneOf[0].properties.env.pattern, "SYNTHETIC_SECRET"],
  ["operation name", schema.properties.writes.properties.operations.items.pattern, "computer.authorise"],
])("exported credential schema enforces complete %s values", (_name, pattern, value) => {
  const constraint = new RegExp(pattern);
  expect(constraint.test(value)).toBe(true);
  expect(constraint.test(`${value}\n`)).toBe(false);
  expect(constraint.test(`${value}\r`)).toBe(false);
  expect(constraint.test(`${value}\r\n`)).toBe(false);
  expect(constraint.test(`${value}\u2028`)).toBe(false);
  expect(constraint.test(`${value}\u2029`)).toBe(false);
});
