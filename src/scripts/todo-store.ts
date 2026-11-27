export type Task = {
	id: string;
	title: string;
	done: boolean;
	priority: "normal" | "high";
	due: string;
	createdAt: string;
	updatedAt: string;
	completedAt: string;
	deletedAt: string;
};
export type TaskDraft = Pick<Task, "title" | "priority" | "due">;
export type TaskFilter = "active" | "all" | "done" | "trash";
export const TASK_STORAGE_KEY = "anxiu-tasks-v1";
export const RECOVERY_PREFIX = "anxiu-tasks-recovery-";
export const MAX_TASKS = 5000;
export const MAX_BACKUP_BYTES = 16 * 1024 * 1024;
export class TodoError extends Error {
	code: "corrupt" | "storage" | "conflict" | "input";
	constructor(message: string, code: TodoError["code"] = "input") {
		super(message);
		this.name = "TodoError";
		this.code = code;
	}
}
function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
export function validDue(value: unknown): value is string {
	if (value === "") return true;
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
		return false;
	const date = new Date(`${value}T00:00:00.000Z`);
	return (
		Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
	);
}
function validStamp(value: unknown, optional = false): value is string {
	return (
		typeof value === "string" &&
		((optional && value === "") ||
			(/^\d{4}-\d{2}-\d{2}T/.test(value) &&
				Number.isFinite(Date.parse(value)) &&
				new Date(value).toISOString() === value))
	);
}
export function validateDraft(input: TaskDraft): TaskDraft {
	if (
		typeof input.title !== "string" ||
		!input.title.trim() ||
		input.title.trim().length > 300
	)
		throw new TodoError("请输入 1–300 个字符的待办内容。");
	if (!validDue(input.due)) throw new TodoError("请选择有效的截止日期。");
	if (input.priority !== "normal" && input.priority !== "high")
		throw new TodoError("优先级不正确。");
	return {
		title: input.title.trim(),
		due: input.due,
		priority: input.priority,
	};
}
export function validateTasks(input: unknown): Task[] {
	if (!Array.isArray(input) || input.length > MAX_TASKS)
		throw new TodoError(`备份应为待办列表，最多 ${MAX_TASKS} 条记录。`);
	const ids = new Set<string>();
	return input.map((value) => {
		if (
			!record(value) ||
			typeof value.id !== "string" ||
			!value.id ||
			value.id.length > 100 ||
			ids.has(value.id) ||
			typeof value.done !== "boolean"
		)
			throw new TodoError("待办数据包含无效或重复的记录。");
		if (
			!validStamp(value.createdAt) ||
			!validStamp(value.updatedAt) ||
			!validStamp(value.completedAt, true) ||
			!validStamp(value.deletedAt, true)
		)
			throw new TodoError("待办记录的时间格式不正确。");
		if (value.done !== Boolean(value.completedAt))
			throw new TodoError("待办完成状态与时间不一致。");
		const draft = validateDraft({
			title: value.title as string,
			due: value.due as string,
			priority: value.priority as Task["priority"],
		});
		ids.add(value.id);
		return {
			id: value.id,
			...draft,
			done: value.done,
			createdAt: value.createdAt,
			updatedAt: value.updatedAt,
			completedAt: value.completedAt,
			deletedAt: value.deletedAt,
		};
	});
}
export function localDay(date = new Date()): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function selectTasks(
	tasks: Task[],
	filter: TaskFilter = "active",
	query = "",
): Task[] {
	const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
	return tasks
		.filter((t) => {
			if (filter === "trash" ? !t.deletedAt : !!t.deletedAt) return false;
			if (filter === "active" && t.done) return false;
			if (filter === "done" && !t.done) return false;
			return words.every((word) => t.title.toLocaleLowerCase().includes(word));
		})
		.sort(
			(a, b) =>
				Number(a.done) - Number(b.done) ||
				Number(b.priority === "high") - Number(a.priority === "high") ||
				(a.due || "9999-99-99").localeCompare(b.due || "9999-99-99") ||
				b.createdAt.localeCompare(a.createdAt) ||
				a.id.localeCompare(b.id),
		);
}
export function mergeTasks(current: Task[], incoming: Task[]) {
	const map = new Map(validateTasks(current).map((t) => [t.id, t]));
	let added = 0;
	let updated = 0;
	let kept = 0;
	for (const task of validateTasks(incoming)) {
		const old = map.get(task.id);
		if (!old) {
			map.set(task.id, task);
			added++;
		} else if (Date.parse(task.updatedAt) > Date.parse(old.updatedAt)) {
			map.set(task.id, task);
			updated++;
		} else kept++;
	}
	return { tasks: validateTasks([...map.values()]), added, updated, kept };
}
export function parseBackup(text: string): Task[] {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new TodoError("文件不是有效的 JSON，原有待办未改变。");
	}
	if (!record(data) || data.format !== "anxiu-todo" || data.version !== 1)
		throw new TodoError("请选择本应用导出的待办备份（版本 1）。");
	return validateTasks(data.tasks);
}
export function makeBackup(
	tasks: Task[],
	now = new Date().toISOString(),
): string {
	return JSON.stringify(
		{
			format: "anxiu-todo",
			version: 1,
			exportedAt: now,
			tasks: validateTasks(tasks),
		},
		null,
		2,
	);
}
type StorageAdapter = Pick<Storage, "getItem" | "setItem">;
type Exclusive = <T>(operation: () => T | Promise<T>) => Promise<T>;
type Options = {
	now?: () => string;
	id?: () => string;
	exclusive?: Exclusive;
	notify?: () => void;
};
export function createTodoStore(
	storage: StorageAdapter,
	options: Options = {},
) {
	const now = options.now || (() => new Date().toISOString());
	const id = options.id || (() => crypto.randomUUID());
	const exclusive: Exclusive =
		options.exclusive || (async (operation) => operation());
	function raw() {
		try {
			return storage.getItem(TASK_STORAGE_KEY);
		} catch {
			throw new TodoError(
				"浏览器无法读取待办存储。请检查浏览器设置后重试。",
				"storage",
			);
		}
	}
	function snapshot() {
		const source = raw();
		if (source === null)
			return { tasks: [] as Task[], revision: 0, source, recoveryKey: "" };
		try {
			const value: unknown = JSON.parse(source);
			// Accept the array form used by early local prototypes, without rewriting it on read.
			if (Array.isArray(value))
				return {
					tasks: validateTasks(value),
					revision: 0,
					source,
					recoveryKey: "",
				};
			if (
				!record(value) ||
				value.version !== 1 ||
				!Number.isSafeInteger(value.revision) ||
				Number(value.revision) < 0
			)
				throw new Error("schema");
			return {
				tasks: validateTasks(value.tasks),
				revision: Number(value.revision),
				source,
				recoveryKey:
					typeof value.recoveryKey === "string" &&
					value.recoveryKey.startsWith(RECOVERY_PREFIX)
						? value.recoveryKey
						: "",
			};
		} catch {
			throw new TodoError(
				"本地待办格式异常，已停止写入以保留原数据。可下载原始数据，或导入有效备份恢复。",
				"corrupt",
			);
		}
	}
	function transaction(update: (tasks: Task[]) => Task[]) {
		return exclusive(() => {
			const current = snapshot();
			const tasks = validateTasks(update(current.tasks));
			if (raw() !== current.source)
				throw new TodoError("另一页刚更新了待办，请重试这次操作。", "conflict");
			try {
				storage.setItem(
					TASK_STORAGE_KEY,
					JSON.stringify({
						version: 1,
						revision: current.revision + 1,
						tasks,
						recoveryKey: current.recoveryKey,
					}),
				);
			} catch {
				throw new TodoError(
					"保存失败，可能是存储空间不足或写入被禁用。内容未清空，请备份后重试。",
					"storage",
				);
			}
			try {
				options.notify?.();
			} catch {
				/* A listener must not turn a successful save into a failure. */
			}
			return tasks;
		});
	}
	function edit(id: string, change: (task: Task) => Task) {
		return transaction((tasks) => {
			if (!tasks.some((t) => t.id === id))
				throw new TodoError("这条待办已不存在，请刷新列表后重试。", "conflict");
			return tasks.map((t) => (t.id === id ? change(t) : t));
		});
	}
	return {
		read: () => snapshot().tasks,
		readRaw: () => raw() ?? "[]",
		readRecovery: () => {
			const current = snapshot();
			if (!current.recoveryKey) return null;
			try {
				return storage.getItem(current.recoveryKey);
			} catch {
				throw new TodoError("无法读取修复前的数据备份。", "storage");
			}
		},
		recover: async (incoming: Task[]) => {
			const tasks = validateTasks(incoming);
			return exclusive(() => {
				const source = raw();
				try {
					snapshot();
					throw new TodoError(
						"当前数据已经可以读取，请重新选择备份并合并。",
						"conflict",
					);
				} catch (error) {
					if (!(error instanceof TodoError) || error.code !== "corrupt")
						throw error;
				}
				if (raw() !== source)
					throw new TodoError(
						"另一页刚更新了数据，请重新读取后再恢复。",
						"conflict",
					);
				const recoveryKey = RECOVERY_PREFIX + id();
				try {
					if (storage.getItem(recoveryKey) !== null)
						throw new Error("duplicate recovery key");
					storage.setItem(recoveryKey, source ?? "");
					storage.setItem(
						TASK_STORAGE_KEY,
						JSON.stringify({ version: 1, revision: 1, tasks, recoveryKey }),
					);
				} catch {
					throw new TodoError(
						"恢复未完成：无法另存原数据或写入待办，当前原数据仍保留。请下载原始数据后释放空间再试。",
						"storage",
					);
				}
				try {
					options.notify?.();
				} catch {
					/* Keep successful writes successful. */
				}
				return tasks;
			});
		},
		add: (draft: TaskDraft) => {
			const input = validateDraft(draft);
			return transaction((tasks) => {
				const stamp = now();
				return [
					...tasks,
					{
						id: id(),
						...input,
						done: false,
						createdAt: stamp,
						updatedAt: stamp,
						completedAt: "",
						deletedAt: "",
					},
				];
			});
		},
		update: (taskId: string, draft: TaskDraft) =>
			edit(taskId, (t) => {
				if (t.deletedAt) throw new TodoError("请先从回收站恢复这条待办。");
				return { ...t, ...validateDraft(draft), updatedAt: now() };
			}),
		setDone: (taskId: string, done: boolean) =>
			edit(taskId, (t) => {
				if (t.deletedAt)
					throw new TodoError("这条待办已移入回收站，请先恢复。");
				if (t.done === done) return t;
				const stamp = now();
				return { ...t, done, completedAt: done ? stamp : "", updatedAt: stamp };
			}),
		trash: (taskId: string) =>
			edit(taskId, (t) =>
				t.deletedAt ? t : { ...t, deletedAt: now(), updatedAt: now() },
			),
		restore: (taskId: string) =>
			edit(taskId, (t) => ({ ...t, deletedAt: "", updatedAt: now() })),
		trashCompleted: () =>
			transaction((tasks) => {
				const stamp = now();
				return tasks.map((t) =>
					t.done && !t.deletedAt
						? { ...t, deletedAt: stamp, updatedAt: stamp }
						: t,
				);
			}),
		restoreTrash: () =>
			transaction((tasks) => {
				const stamp = now();
				return tasks.map((t) =>
					t.deletedAt ? { ...t, deletedAt: "", updatedAt: stamp } : t,
				);
			}),
		import: async (incoming: Task[]) => {
			let result = { added: 0, updated: 0, kept: 0 };
			const tasks = await transaction((current) => {
				const merged = mergeTasks(current, incoming);
				result = {
					added: merged.added,
					updated: merged.updated,
					kept: merged.kept,
				};
				return merged.tasks;
			});
			return { tasks, ...result };
		},
	};
}
export type TodoStore = ReturnType<typeof createTodoStore>;
