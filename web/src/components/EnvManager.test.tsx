// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockListEnvs = vi.fn();
const mockGetContainerStatus = vi.fn();
const mockGetContainerImages = vi.fn();
const mockUpdateEnv = vi.fn();
const mockCreateEnv = vi.fn();

vi.mock("../api.js", () => ({
  api: {
    listEnvs: () => mockListEnvs(),
    getContainerStatus: () => mockGetContainerStatus(),
    getContainerImages: () => mockGetContainerImages(),
    updateEnv: (...args: unknown[]) => mockUpdateEnv(...args),
    createEnv: (...args: unknown[]) => mockCreateEnv(...args),
    deleteEnv: vi.fn(),
    buildEnvImage: vi.fn(),
    getEnvBuildStatus: vi.fn(),
  },
}));

import { EnvManager } from "./EnvManager.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockListEnvs.mockResolvedValue([
    {
      name: "Companion",
      slug: "companion",
      variables: { CLAUDE_CODE_OAUTH_TOKEN: "tok" },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ]);
  mockGetContainerStatus.mockResolvedValue({ available: true, version: "27.5.1" });
  mockGetContainerImages.mockResolvedValue(["the-companion:latest"]);
  mockUpdateEnv.mockResolvedValue({});
  mockCreateEnv.mockResolvedValue({});
});

describe("EnvManager existing env edit", () => {
  it("shows Docker controls and persists baseImage update", async () => {
    render(<EnvManager embedded />);

    await screen.findByText("Companion");
    fireEvent.click(screen.getByText("Edit"));

    // Docker controls are visible in existing env edit mode.
    const baseImageSelect = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    expect(baseImageSelect.value).toBe("");
    fireEvent.change(baseImageSelect, { target: { value: "the-companion:latest" } });

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(mockUpdateEnv).toHaveBeenCalledWith(
        "companion",
        expect.objectContaining({ baseImage: "the-companion:latest" }),
      );
    });
  });

  it("pre-fills Claude settings in edit mode and normalizes valid JSON on save", async () => {
    mockListEnvs.mockResolvedValueOnce([
      {
        name: "Companion",
        slug: "companion",
        variables: {},
        claudeSettings: '{ "featureFlag": true }',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    render(<EnvManager embedded />);

    await screen.findByText("Companion");
    fireEvent.click(screen.getByText("Edit"));

    // Existing value should be surfaced back to the user.
    const settingsArea = screen.getByPlaceholderText(/"deny": \["WebSearch"\]/) as HTMLTextAreaElement;
    expect(settingsArea.value).toBe('{ "featureFlag": true }');

    fireEvent.change(settingsArea, { target: { value: '{ "nested": { "x": 1 } }' } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(mockUpdateEnv).toHaveBeenCalledWith(
        "companion",
        expect.objectContaining({ claudeSettings: "{\"nested\":{\"x\":1}}" }),
      );
    });
  });

  it("normalizes Codex config lines and persists on save", async () => {
    mockListEnvs.mockResolvedValueOnce([
      {
        name: "Companion",
        slug: "companion",
        variables: {},
        codexConfig: ["model=\"gpt-5-codex\""],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    render(<EnvManager embedded />);
    await screen.findByText("Companion");
    fireEvent.click(screen.getByText("Edit"));

    const codexArea = screen.getByPlaceholderText(/shell_environment_policy\.inherit="all"/) as HTMLTextAreaElement;
    expect(codexArea.value).toBe("model=\"gpt-5-codex\"");
    fireEvent.change(codexArea, { target: { value: "model=\"gpt-5-codex\"\nsandbox_permissions=[\"disk-full-read-access\"]" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(mockUpdateEnv).toHaveBeenCalledWith(
        "companion",
        expect.objectContaining({ codexConfig: ["model=\"gpt-5-codex\"", "sandbox_permissions=[\"disk-full-read-access\"]"] }),
      );
    });
  });

  it("sends nulls when Claude/Codex settings are cleared", async () => {
    mockListEnvs.mockResolvedValueOnce([
      {
        name: "Companion",
        slug: "companion",
        variables: {},
        claudeSettings: "{\"trace\":true}",
        codexConfig: ["model=\"gpt-5-codex\""],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    render(<EnvManager embedded />);
    await screen.findByText("Companion");
    fireEvent.click(screen.getByText("Edit"));

    const settingsArea = screen.getByPlaceholderText(/"deny": \["WebSearch"\]/) as HTMLTextAreaElement;
    const codexArea = screen.getByPlaceholderText(/shell_environment_policy\.inherit="all"/) as HTMLTextAreaElement;
    fireEvent.change(settingsArea, { target: { value: "" } });
    fireEvent.change(codexArea, { target: { value: "" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(mockUpdateEnv).toHaveBeenCalledWith(
        "companion",
        expect.objectContaining({ claudeSettings: null, codexConfig: null }),
      );
    });
  });

  it("blocks save when Claude settings JSON is invalid", async () => {
    render(<EnvManager embedded />);

    await screen.findByText("Companion");
    fireEvent.click(screen.getByText("Edit"));

    const settingsArea = screen.getByPlaceholderText(/"deny": \["WebSearch"\]/) as HTMLTextAreaElement;
    fireEvent.change(settingsArea, { target: { value: "{\"broken\":" } });
    fireEvent.click(screen.getByText("Save"));

    expect(await screen.findByText("Claude settings must be valid JSON.")).toBeTruthy();
    expect(mockUpdateEnv).not.toHaveBeenCalled();
  });

  it("blocks save when Codex config line is missing =", async () => {
    render(<EnvManager embedded />);
    await screen.findByText("Companion");
    fireEvent.click(screen.getByText("Edit"));

    const codexArea = screen.getByPlaceholderText(/shell_environment_policy\.inherit="all"/) as HTMLTextAreaElement;
    fireEvent.change(codexArea, { target: { value: "just-key" } });
    fireEvent.click(screen.getByText("Save"));

    expect(await screen.findByText('Codex config entry "just-key" must use key=value format.')).toBeTruthy();
    expect(mockUpdateEnv).not.toHaveBeenCalled();
  });

  it("blocks save when Codex config key path is invalid", async () => {
    render(<EnvManager embedded />);
    await screen.findByText("Companion");
    fireEvent.click(screen.getByText("Edit"));

    const codexArea = screen.getByPlaceholderText(/shell_environment_policy\.inherit="all"/) as HTMLTextAreaElement;
    fireEvent.change(codexArea, { target: { value: ".invalid=1" } });
    fireEvent.click(screen.getByText("Save"));

    expect(await screen.findByText(/must use a dotted key path before '='/)).toBeTruthy();
    expect(mockUpdateEnv).not.toHaveBeenCalled();
  });

  it("blocks save when Codex config value is not valid TOML", async () => {
    render(<EnvManager embedded />);
    await screen.findByText("Companion");
    fireEvent.click(screen.getByText("Edit"));

    const codexArea = screen.getByPlaceholderText(/shell_environment_policy\.inherit="all"/) as HTMLTextAreaElement;
    fireEvent.change(codexArea, { target: { value: "model=\"gpt-5-codex\"\nnotes=\"unterminated" } });
    fireEvent.click(screen.getByText("Save"));

    expect(await screen.findByText(/must have a valid TOML value after '='/)).toBeTruthy();
    expect(mockUpdateEnv).not.toHaveBeenCalled();
  });
});

describe("EnvManager create flow", () => {
  it("sends normalized claudeSettings when creating an environment", async () => {
    render(<EnvManager embedded />);

    await screen.findByText("New Environment");
    fireEvent.change(screen.getByPlaceholderText(/Environment name/i), { target: { value: "New Env" } });
    fireEvent.click(screen.getByRole("button", { name: "settings" }));

    const settingsArea = screen.getByPlaceholderText(/"deny": \["WebSearch"\]/) as HTMLTextAreaElement;
    fireEvent.change(settingsArea, { target: { value: '{ "trace": true }' } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(mockCreateEnv).toHaveBeenCalledWith(
        "New Env",
        {},
        expect.objectContaining({ claudeSettings: "{\"trace\":true}" }),
      );
    });
  });

  it("sends codexConfig lines when creating an environment", async () => {
    render(<EnvManager embedded />);

    await screen.findByText("New Environment");
    fireEvent.change(screen.getByPlaceholderText(/Environment name/i), { target: { value: "Codex Env" } });
    fireEvent.click(screen.getByRole("button", { name: "settings" }));

    const codexArea = screen.getByPlaceholderText(/shell_environment_policy\.inherit="all"/) as HTMLTextAreaElement;
    fireEvent.change(codexArea, { target: { value: "model=\"gpt-5-codex\"\nshell_environment_policy.inherit=\"all\"" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(mockCreateEnv).toHaveBeenCalledWith(
        "Codex Env",
        {},
        expect.objectContaining({ codexConfig: ["model=\"gpt-5-codex\"", "shell_environment_policy.inherit=\"all\""] }),
      );
    });
  });
});
