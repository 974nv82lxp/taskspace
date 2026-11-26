
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const PORT = 43127;
const TEST_DATABASE_PATH = path.resolve(
    process.cwd(),
    "data",
    "taskspace-test.db"
);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TEST_SECRET = randomBytes(48).toString("hex");
const suffix = randomBytes(5).toString("hex");

const usernameA = `test_a_${suffix}`;
const usernameB = `test_b_${suffix}`;
const password = "TestPassword123!";

let serverProcess;
let cookieA;
let cookieB;
let taskId;
let secondTaskId;

async function request(endpoint, options = {}) {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
        ...options,
        headers: {
            ...(options.cookie
                ? { Cookie: options.cookie }
                : {}),
            ...(options.body
                ? { "Content-Type": "application/json" }
                : {}),
            ...options.headers
        }
    });

    const data = await response.json().catch(() => ({}));

    return {
        status: response.status,
        data,
        cookie: response.headers.get("set-cookie")?.split(";")[0]
    };
}

async function waitForServer() {
    const deadline = Date.now() + 15000;

    while (Date.now() < deadline) {
        if (serverProcess.exitCode !== null) {
            throw new Error(
                `Server exited unexpectedly with code ${serverProcess.exitCode}.`
            );
        }

        try {
            const response = await fetch(`${BASE_URL}/api/health`);

            if (response.ok) {
                return;
            }
        } catch {
            // The server may not have started yet.
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(
        "Server did not start within 15 seconds. Check whether the test port is already in use."
    );
}

test("TaskSpace backend integration and security checks", async (t) => {
    serverProcess = spawn(
        process.execPath,
        ["src/server.js"],
        {
            cwd: process.cwd(),
            env: {
                ...process.env,
                PORT: String(PORT),
                SESSION_SECRET: TEST_SECRET,
                NODE_ENV: "test",
                TASKSPACE_DB_PATH: TEST_DATABASE_PATH
            },
            stdio: "ignore"
        }
    );

    await waitForServer();

    await t.test("Health endpoint returns OK", async () => {
        const result = await request("/api/health");

        assert.equal(result.status, 200);
        assert.equal(result.data.status, "ok");
        assert.equal(result.data.application, "TaskSpace");
    });

    await t.test("Unauthenticated users cannot list tasks", async () => {
        const result = await request("/api/tasks");

        assert.equal(result.status, 401);
    });

    await t.test("Registration rejects invalid usernames", async () => {
        const result = await request("/api/auth/register", {
            method: "POST",
            body: JSON.stringify({
                username: "ab",
                password
            })
        });

        assert.equal(result.status, 400);
    });

    await t.test("User A can register", async () => {
        const result = await request("/api/auth/register", {
            method: "POST",
            body: JSON.stringify({
                username: usernameA,
                password
            })
        });

        assert.equal(result.status, 201);
        assert.equal(result.data.user.username, usernameA);
        assert.ok(result.cookie);

        cookieA = result.cookie;
    });

    await t.test("Duplicate usernames are rejected", async () => {
        const result = await request("/api/auth/register", {
            method: "POST",
            body: JSON.stringify({
                username: usernameA.toUpperCase(),
                password
            })
        });

        assert.equal(result.status, 409);
    });

    await t.test("User A can create a categorized task", async () => {
        const result = await request("/api/tasks", {
            method: "POST",
            cookie: cookieA,
            body: JSON.stringify({
                title: "Automated security test task",
                category: "Work",
                priority: "high",
                due_date: "2030-05-20"
            })
        });

        assert.equal(result.status, 201);
        assert.equal(
            result.data.task.title,
            "Automated security test task"
        );
        assert.equal(result.data.task.category, "Work");
        assert.equal(result.data.task.priority, "high");
        assert.equal(result.data.task.due_date, "2030-05-20");

        taskId = result.data.task.id;
    });

    await t.test("User A can create a task in another category", async () => {
        const result = await request("/api/tasks", {
            method: "POST",
            cookie: cookieA,
            body: JSON.stringify({
                title: "Study category test task",
                category: "Study",
                priority: "medium"
            })
        });

        assert.equal(result.status, 201);
        assert.equal(result.data.task.category, "Study");

        secondTaskId = result.data.task.id;
    });

    await t.test("Category filter returns only matching tasks", async () => {
        const result = await request("/api/tasks?category=Work", {
            cookie: cookieA
        });

        assert.equal(result.status, 200);
        assert.equal(result.data.tasks.length, 1);
        assert.equal(result.data.tasks[0].id, taskId);
        assert.equal(result.data.tasks[0].category, "Work");
    });

    await t.test("Study filter returns the Study task", async () => {
        const result = await request("/api/tasks?category=Study", {
            cookie: cookieA
        });

        assert.equal(result.status, 200);
        assert.equal(result.data.tasks.length, 1);
        assert.equal(result.data.tasks[0].id, secondTaskId);
        assert.equal(result.data.tasks[0].category, "Study");
    });

    await t.test("Invalid task categories are rejected", async () => {
        const result = await request("/api/tasks", {
            method: "POST",
            cookie: cookieA,
            body: JSON.stringify({
                title: "Invalid category test",
                category: "InvalidCategory"
            })
        });

        assert.equal(result.status, 400);
    });

    await t.test("User A can change a task category", async () => {
        const result = await request(`/api/tasks/${taskId}`, {
            method: "PATCH",
            cookie: cookieA,
            body: JSON.stringify({
                category: "Personal"
            })
        });

        assert.equal(result.status, 200);
        assert.equal(result.data.task.category, "Personal");
    });

    await t.test("Invalid category updates are rejected", async () => {
        const result = await request(`/api/tasks/${taskId}`, {
            method: "PATCH",
            cookie: cookieA,
            body: JSON.stringify({
                category: "InvalidCategory"
            })
        });

        assert.equal(result.status, 400);
    });

    await t.test("User B can register independently", async () => {
        const result = await request("/api/auth/register", {
            method: "POST",
            body: JSON.stringify({
                username: usernameB,
                password
            })
        });

        assert.equal(result.status, 201);
        assert.ok(result.cookie);

        cookieB = result.cookie;
    });

    await t.test("User B cannot see User A's tasks or categories", async () => {
        const result = await request("/api/tasks", {
            cookie: cookieB
        });

        assert.equal(result.status, 200);
        assert.equal(result.data.tasks.length, 0);
    });

    await t.test("User B cannot modify User A's task", async () => {
        const result = await request(`/api/tasks/${taskId}`, {
            method: "PATCH",
            cookie: cookieB,
            body: JSON.stringify({ completed: true })
        });

        assert.equal(result.status, 404);
    });

    await t.test("User B cannot delete User A's task", async () => {
        const result = await request(`/api/tasks/${taskId}`, {
            method: "DELETE",
            cookie: cookieB
        });

        assert.equal(result.status, 404);
    });

    await t.test("User A can complete their own task", async () => {
        const result = await request(`/api/tasks/${taskId}`, {
            method: "PATCH",
            cookie: cookieA,
            body: JSON.stringify({ completed: true })
        });

        assert.equal(result.status, 200);
        assert.equal(result.data.task.completed, 1);
    });

    await t.test("User A can delete their own task", async () => {
        const result = await request(`/api/tasks/${taskId}`, {
            method: "DELETE",
            cookie: cookieA
        });

        assert.equal(result.status, 200);
    });

    await t.test("User A can delete their second test task", async () => {
        const result = await request(`/api/tasks/${secondTaskId}`, {
            method: "DELETE",
            cookie: cookieA
        });

        assert.equal(result.status, 200);
    });

    await t.test("Login works with the registered account", async () => {
        const result = await request("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({
                username: usernameA,
                password
            })
        });

        assert.equal(result.status, 200);
        assert.equal(result.data.user.username, usernameA);
        assert.ok(result.cookie);
        cookieA = result.cookie;
    });

    await t.test("Authenticated session survives server restart", async () => {
        const previousServer = serverProcess;

        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error("Test server did not stop within 5 seconds."));
            }, 5000);

            previousServer.once("exit", () => {
                clearTimeout(timeout);
                resolve();
            });

            previousServer.kill("SIGTERM");
        });

        serverProcess = spawn(
            process.execPath,
            ["src/server.js"],
            {
                cwd: process.cwd(),
                env: {
                    ...process.env,
                    PORT: String(PORT),
                    SESSION_SECRET: TEST_SECRET,
                    NODE_ENV: "test",
                    TASKSPACE_DB_PATH: TEST_DATABASE_PATH
                },
                stdio: "ignore"
            }
        );

        await waitForServer();

        const result = await request("/api/auth/me", {
            cookie: cookieA
        });

        assert.equal(result.status, 200);
        assert.equal(result.data.user.username, usernameA);
    });
    await t.test("Incorrect passwords are rejected", async () => {
        const result = await request("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({
                username: usernameA,
                password: "WrongPassword123!"
            })
        });

        assert.equal(result.status, 401);
    });
});

after(async () => {
    if (serverProcess && serverProcess.exitCode === null) {
        serverProcess.kill("SIGTERM");

        await new Promise((resolve) => {
            const timeout = setTimeout(resolve, 3000);

            serverProcess.once("exit", () => {
                clearTimeout(timeout);
                resolve();
            });
        });
    }

    // Clean up only the separate test database.
    if (fs.existsSync(TEST_DATABASE_PATH)) {
        const testDb = new Database(TEST_DATABASE_PATH);
        testDb.pragma("foreign_keys = ON");

        try {
            testDb.prepare(`
                DELETE FROM users
                WHERE username IN (?, ?)
            `).run(usernameA, usernameB);
        } finally {
            testDb.close();
        }
    }
});


