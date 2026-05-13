export function isFileSystemAccessSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function requestDirectoryPermission(dirHandle) {
  if (!dirHandle || !dirHandle.requestPermission) return 'denied';
  return await dirHandle.requestPermission({ mode: 'read' });
}

export async function getFilesFromDirectoryHandle(dirHandle, path = '') {
  const files = [];
  for await (const entry of dirHandle.values()) {
    const entryPath = path ? `${path}/${entry.name}` : entry.name;
    if (entry.kind === 'file') {
      const file = await entry.getFile();
      file.relativePath = entryPath;
      files.push(file);
    } else if (entry.kind === 'directory') {
      const subFiles = await getFilesFromDirectoryHandle(entry, entryPath);
      files.push(...subFiles);
    }
  }
  return files;
}
