export interface BackgroundPhoto {
	blob: Blob;
	name: string;
}
export const MAX_BACKGROUND_BYTES = 10 * 1024 * 1024;
const types = new Set(["image/png", "image/jpeg", "image/webp", "image/avif"]);
export function validPhoto(value: unknown): value is BackgroundPhoto {
	if (!value || typeof value !== "object") return false;
	const p = value as BackgroundPhoto;
	return (
		p.blob instanceof Blob &&
		types.has(p.blob.type) &&
		p.blob.size > 0 &&
		p.blob.size <= MAX_BACKGROUND_BYTES &&
		typeof p.name === "string"
	);
}
function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		let failed = false;
		const request = indexedDB.open("anxiu-appearance", 1);
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains("images"))
				request.result.createObjectStore("images");
		};
		request.onerror = () => {
			failed = true;
			reject(request.error);
		};
		request.onblocked = () => {
			failed = true;
			reject(new Error("database blocked"));
		};
		request.onsuccess = () => {
			if (failed) {
				request.result.close();
				return;
			}
			request.result.onversionchange = () => request.result.close();
			resolve(request.result);
		};
	});
}
async function transaction(
	action: "get" | "put" | "delete",
	photo?: BackgroundPhoto,
): Promise<unknown> {
	const db = await openDatabase();
	try {
		return await new Promise((resolve, reject) => {
			const tx = db.transaction(
				"images",
				action === "get" ? "readonly" : "readwrite",
			);
			const store = tx.objectStore("images");
			const request =
				action === "get"
					? store.get("background")
					: action === "put"
						? store.put(photo, "background")
						: store.delete("background");
			let result: unknown;
			request.onsuccess = () => {
				result = request.result;
			};
			tx.oncomplete = () => resolve(result);
			tx.onabort = () => reject(tx.error || new Error("aborted"));
			tx.onerror = () => reject(tx.error || new Error("storage failed"));
		});
	} finally {
		db.close();
	}
}
export async function readPhoto(): Promise<BackgroundPhoto | undefined> {
	const photo = await transaction("get");
	return validPhoto(photo) ? photo : undefined;
}
export async function storePhoto(photo: BackgroundPhoto): Promise<void> {
	if (!validPhoto(photo)) throw new Error("invalid image");
	await transaction("put", photo);
}
export async function deletePhoto(): Promise<void> {
	await transaction("delete");
}
