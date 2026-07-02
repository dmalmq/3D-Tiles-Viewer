export function snapshotAndClearFileInput(input) {
  const files = Array.from(input?.files ?? []);
  if (input) input.value = "";
  return files;
}

