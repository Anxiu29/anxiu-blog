export interface BackgroundPhoto {
	blob: Blob;
	name: string;
}
export const MAX_BACKGROUND_BYTES = 10 * 1024 * 1024;
export const BACKGROUND_PHOTO_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/avif",
	"image/gif",
	"image/apng",
];
const types = new Set(BACKGROUND_PHOTO_TYPES);
export function isBackgroundPhotoType(type: string) {
	return types.has(type);
}
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
export interface BackgroundLocalVideo extends BackgroundPhoto {
	poster: Blob;
}
export const MAX_BACKGROUND_VIDEO_BYTES = 100 * 1024 * 1024;
export function validLocalVideo(value: unknown): value is BackgroundLocalVideo {
	if (!value || typeof value !== "object") return false;
	const v = value as BackgroundLocalVideo;
	return (
		v.blob instanceof Blob &&
		v.blob.type === "video/mp4" &&
		v.blob.size > 0 &&
		v.blob.size <= MAX_BACKGROUND_VIDEO_BYTES &&
		typeof v.name === "string" &&
		v.poster instanceof Blob &&
		v.poster.type === "image/jpeg" &&
		v.poster.size > 0 &&
		v.poster.size <= 1024 * 1024
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
	key = "background",
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
					? store.get(key)
					: action === "put"
						? store.put(photo, key)
						: store.delete(key);
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

export async function readLocalVideo(): Promise<
	BackgroundLocalVideo | undefined
> {
	const value = await transaction("get", undefined, "video");
	return validLocalVideo(value) ? value : undefined;
}
export async function storeLocalVideo(
	value: BackgroundLocalVideo,
): Promise<void> {
	if (!validLocalVideo(value)) throw new Error("invalid video");
	await transaction("put", value, "video");
}
export async function deleteLocalVideo(): Promise<void> {
	await transaction("delete", undefined, "video");
}
