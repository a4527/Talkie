export async function requestAccountAction(data: Record<string, unknown>) {
  const result = await fetch("/api/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const value = await result.json();
  if (!result.ok) throw new Error(value.error);
  return value;
}
