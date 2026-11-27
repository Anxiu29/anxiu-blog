const assert = require("node:assert/strict");
const test = require("node:test");
const {
	createTodoStore,
	validateTasks,
	validDue,
	parseBackup,
	makeBackup,
	mergeTasks,
	selectTasks,
	localDay,
	TASK_STORAGE_KEY,
	MAX_TASKS,
} = require("../src/scripts/todo-store.ts");
function fixture() {
	const values = new Map();
	let writes = 0;
	let notifications = 0;
	let blocked = false;
	let readBlocked = false;
	let clock = 0;
	let ids = 0;
	let queue = Promise.resolve();
	const storage = {
		getItem: (key) => {
			if (readBlocked) throw Error("blocked read");
			return values.get(key) ?? null;
		},
		setItem: (key, value) => {
			if (blocked) throw Error("quota");
			values.set(key, value);
			writes++;
		},
	};
	const options = {
		now: () => new Date(Date.UTC(2026, 10, 24, 0, 0, clock++)).toISOString(),
		id: () => `task-${++ids}`,
		notify: () => notifications++,
		exclusive: (operation) => {
			const next = queue.then(operation);
			queue = next.catch(() => {});
			return next;
		},
	};
	return {
		values,
		storage,
		options,
		store: createTodoStore(storage, options),
		block: () => (blocked = true),
		unblock: () => (blocked = false),
		blockRead: () => (readBlocked = true),
		writes: () => writes,
		notifications: () => notifications,
	};
}
const draft = (title = "记录一个真实任务", due = "", priority = "normal") => ({
	title,
	due,
	priority,
});
test("repair preserves exact damaged source and keeps it downloadable after later edits", async () => {
	const clean = fixture();
	await clean.store.add(draft("有效备份里的任务"));
	const f = fixture();
	const broken = "{broken\n不可丢失的原始数据";
	f.values.set(TASK_STORAGE_KEY, broken);
	await f.store.recover(clean.store.read());
	assert.equal(f.store.read().length, 1);
	assert.equal(f.store.readRecovery(), broken);
	await f.store.update("task-1", draft("恢复后仍可修改"));
	assert.equal(f.store.readRecovery(), broken);
	assert.equal(createTodoStore(f.storage, f.options).readRecovery(), broken);
	const original = f.values.get(TASK_STORAGE_KEY);
	await assert.rejects(() => f.store.recover([]), /已经可以读取/);
	assert.equal(f.values.get(TASK_STORAGE_KEY), original);
});
test("repair fails safely if quarantine or final write cannot be saved", async () => {
	const f = fixture();
	const broken = "broken bytes";
	f.values.set(TASK_STORAGE_KEY, broken);
	f.block();
	await assert.rejects(() => f.store.recover([]), /原数据仍保留/);
	assert.equal(f.values.get(TASK_STORAGE_KEY), broken);
	f.unblock();
	const storage = {
		...f.storage,
		setItem: (key, value) => {
			if (key === TASK_STORAGE_KEY) throw Error("main quota");
			f.storage.setItem(key, value);
		},
	};
	const store = createTodoStore(storage, f.options);
	await assert.rejects(() => store.recover([]), /原数据仍保留/);
	assert.equal(f.values.get(TASK_STORAGE_KEY), broken);
	assert.ok(
		[...f.values.entries()].some(
			([key, value]) =>
				key.startsWith("anxiu-tasks-recovery-") && value === broken,
		),
	);
});
test("real calendar dates, title boundaries and clean schema", () => {
	assert.equal(validDue("2026-02-29"), false);
	assert.equal(validDue("2028-02-29"), true);
	assert.equal(validDue("2026-04-31"), false);
	assert.equal(validDue("2026-2-01"), false);
	assert.equal(localDay(new Date(2026, 0, 2, 23, 30)), "2026-01-02");
	const task = {
		id: "a",
		...draft("  长标题  "),
		done: false,
		createdAt: "2026-11-24T00:00:00.000Z",
		updatedAt: "2026-11-24T00:00:00.000Z",
		completedAt: "",
		deletedAt: "",
		unknown: "discard",
	};
	assert.equal(validateTasks([task])[0].title, "长标题");
	assert.equal(validateTasks([task])[0].unknown, undefined);
	assert.throws(() => validateTasks([{ ...task, title: " ".repeat(10) }]));
	assert.throws(() => validateTasks([{ ...task, title: "字".repeat(301) }]));
	assert.throws(() => validateTasks([task, task]));
	assert.throws(() => validateTasks([{ ...task, done: true }]));
	assert.throws(() =>
		validateTasks([{ ...task, createdAt: "2026-02-30T00:00:00.000Z" }]),
	);
});
test("add, edit all editable fields, complete, undo, soft delete and restore", async () => {
	const f = fixture();
	assert.deepEqual(f.store.read(), []);
	assert.equal(f.writes(), 0);
	await f.store.add(draft("先做一件事"));
	let task = f.store.read()[0];
	await f.store.update(task.id, draft("改过的任务", "2026-11-25", "high"));
	task = f.store.read()[0];
	assert.equal(task.title, "改过的任务");
	assert.equal(task.priority, "high");
	assert.equal(task.due, "2026-11-25");
	await f.store.setDone(task.id, true);
	assert.ok(f.store.read()[0].completedAt);
	await f.store.trash(task.id);
	assert.ok(f.store.read()[0].deletedAt);
	assert.equal(f.store.read()[0].done, true);
	await assert.rejects(() => f.store.setDone(task.id, false));
	await f.store.restore(task.id);
	assert.equal(f.store.read()[0].done, true);
	await f.store.setDone(task.id, false);
	assert.equal(f.store.read()[0].completedAt, "");
	assert.equal(f.notifications(), f.writes());
});
test("failed writes preserve the exact previous snapshot and allow a later retry", async () => {
	const f = fixture();
	await f.store.add(draft("保留原始任务"));
	const original = f.values.get(TASK_STORAGE_KEY);
	const events = f.notifications();
	f.block();
	await assert.rejects(
		() => f.store.add(draft("失败后输入仍应保留")),
		/保存失败/,
	);
	await assert.rejects(() => f.store.setDone("task-1", true), /保存失败/);
	assert.equal(f.values.get(TASK_STORAGE_KEY), original);
	assert.equal(f.notifications(), events);
	f.unblock();
	await f.store.add(draft("失败后输入仍应保留"));
	assert.equal(f.store.read().length, 2);
});
test("blocked reads and malformed local data never trigger an automatic reset", async () => {
	const f = fixture();
	f.values.set(TASK_STORAGE_KEY, "{broken\n私人的原始文本");
	assert.throws(() => f.store.read(), /原数据/);
	await assert.rejects(() => f.store.add(draft("不能覆盖")), /原数据/);
	assert.equal(f.store.readRaw(), "{broken\n私人的原始文本");
	assert.equal(f.writes(), 0);
	f.blockRead();
	assert.throws(() => f.store.read(), /无法读取/);
	await assert.rejects(() => f.store.add(draft()), /无法读取/);
	assert.equal(f.writes(), 0);
});
test("backup round-trip preserves Unicode, completion, priority, due date and trash", async () => {
	const f = fixture();
	await f.store.add(
		draft("喝水 🍵 中文 <script>只是文字</script>", "2026-12-01", "high"),
	);
	await f.store.setDone("task-1", true);
	await f.store.trash("task-1");
	const tasks = f.store.read();
	assert.deepEqual(parseBackup(makeBackup(tasks)), tasks);
	const other = fixture();
	const result = await other.store.import(parseBackup(makeBackup(tasks)));
	assert.equal(result.added, 1);
	assert.deepEqual(other.store.read(), tasks);
});
test("imports merge newer records and cannot resurrect a newer deleted record", async () => {
	const f = fixture();
	await f.store.add(draft("原记录"));
	const before = f.store.read()[0];
	await f.store.trash(before.id);
	const incoming = [before, { ...before, id: "external", title: "从备份新增" }];
	const result = await f.store.import(incoming);
	assert.equal(result.added, 1);
	assert.equal(result.kept, 1);
	assert.ok(f.store.read().find((t) => t.id === before.id).deletedAt);
	const repeated = await f.store.import(incoming);
	assert.equal(repeated.added, 0);
	assert.equal(repeated.kept, 2);
	assert.equal(f.store.read().length, 2);
	const newer = {
		...before,
		title: "较新的备份修改",
		updatedAt: "2026-12-01T00:00:00.000Z",
	};
	const merged = mergeTasks([before], [newer]);
	assert.equal(merged.updated, 1);
	assert.equal(merged.tasks[0].title, newer.title);
});
test("invalid, duplicate, unsupported or over-limit backups leave storage untouched", async () => {
	const f = fixture();
	await f.store.add(draft());
	const original = f.values.get(TASK_STORAGE_KEY);
	const task = f.store.read()[0];
	assert.throws(() => parseBackup("{oops"));
	assert.throws(() => parseBackup('{"format":"other","version":1,"tasks":[]}'));
	assert.throws(() =>
		parseBackup(makeBackup([task]).replace('"version": 1', '"version": 2')),
	);
	await assert.rejects(() => f.store.import([task, task]));
	const full = Array.from({ length: MAX_TASKS }, (_, i) => ({
		...task,
		id: `large-${i}`,
	}));
	await assert.rejects(() => f.store.import(full), /最多/);
	assert.equal(f.values.get(TASK_STORAGE_KEY), original);
});
test("serialized writers reread latest state rather than losing another tab changes", async () => {
	const f = fixture();
	const other = createTodoStore(f.storage, f.options);
	await Promise.all([
		f.store.add(draft("第一页新增")),
		other.add(draft("第二页新增")),
	]);
	assert.equal(f.store.read().length, 2);
	await Promise.all([
		f.store.update("task-1", draft("第一页修改")),
		other.trash("task-2"),
	]);
	assert.equal(f.store.read()[0].title, "第一页修改");
	assert.ok(f.store.read()[1].deletedAt);
});
test("bulk operations affect only the intended completed or trashed records", async () => {
	const f = fixture();
	await f.store.add(draft("未完成"));
	await f.store.add(draft("已完成"));
	await f.store.setDone("task-2", true);
	await f.store.trashCompleted();
	assert.equal(f.store.read()[0].deletedAt, "");
	assert.ok(f.store.read()[1].deletedAt);
	await f.store.restoreTrash();
	assert.equal(f.store.read()[1].done, true);
	assert.equal(f.store.read()[1].deletedAt, "");
});
test("filters, multiword search and deterministic order do not mutate input", async () => {
	const f = fixture();
	await f.store.add(draft("Vue 学习笔记", "2026-11-25"));
	await f.store.add(draft("Vue 重要复盘", "2026-11-26", "high"));
	await f.store.add(draft("另一个任务"));
	const tasks = f.store.read();
	const before = JSON.stringify(tasks);
	assert.equal(selectTasks(tasks, "active", "vue 学习").length, 1);
	assert.equal(selectTasks(tasks)[0].priority, "high");
	await f.store.setDone("task-2", true);
	assert.equal(selectTasks(f.store.read(), "active").length, 2);
	assert.equal(selectTasks(f.store.read(), "done").length, 1);
	assert.equal(selectTasks(f.store.read(), "trash").length, 0);
	assert.equal(JSON.stringify(tasks), before);
});
test("notification failures cannot misreport a successful save", async () => {
	const f = fixture();
	const store = createTodoStore(f.storage, {
		...f.options,
		notify: () => {
			throw Error("bad listener");
		},
	});
	await store.add(draft());
	assert.equal(store.read().length, 1);
});
