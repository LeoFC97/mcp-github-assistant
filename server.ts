import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Octokit } from "@octokit/rest";
import { z } from "zod";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const server = new McpServer({
  name: "github-assistant",
  version: "1.0.0",
});

// --- TOOLS ---

server.tool(
  "list_repositories",
  "Lists repositories for a given GitHub organization or user.",
  {
    owner: z.string().describe("GitHub username or organization name"),
    type: z.enum(["all", "public", "private", "forks", "sources"]).optional().default("all").describe("Type of repositories to list"),
    sort: z.enum(["created", "updated", "pushed", "full_name"]).optional().default("updated").describe("Sort order"),
  },
  async ({ owner, type, sort }) => {
    try {
      const { data } = await octokit.repos.listForUser({ username: owner, type, sort, per_page: 30 });
      const list = data.map(r => `- ${r.name} - ${r.description ?? "(no description)"} [${r.private ? "private" : "public"}]`).join("\n");
      return { content: [{ type: "text", text: `Repositories for ${owner}:\n\n${list}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

server.tool(
  "get_repository",
  "Returns full metadata and stats for a GitHub repository.",
  {
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
  },
  async ({ owner, repo }) => {
    try {
      const { data: r } = await octokit.repos.get({ owner, repo });
      const text = [
        `Repository: ${r.full_name}`,
        `Description: ${r.description ?? "(none)"}`,
        `Language: ${r.language ?? "N/A"}`,
        `Stars: ${r.stargazers_count} | Forks: ${r.forks_count} | Open Issues: ${r.open_issues_count}`,
        `Default Branch: ${r.default_branch}`,
        `Visibility: ${r.private ? "Private" : "Public"}`,
        `Created: ${r.created_at} | Last Push: ${r.pushed_at}`,
        `URL: ${r.html_url}`,
      ].join("\n");
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

server.tool(
  "list_pull_requests",
  "Lists pull requests in a repository, with optional filters by state and author.",
  {
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    state: z.enum(["open", "closed", "all"]).optional().default("open").describe("PR state filter"),
    author: z.string().optional().describe("Filter PRs by author username"),
  },
  async ({ owner, repo, state, author }) => {
    try {
      const { data } = await octokit.pulls.list({ owner, repo, state, per_page: 30 });
      const filtered = author ? data.filter(pr => pr.user?.login === author) : data;
      if (filtered.length === 0) {
        return { content: [{ type: "text", text: `No ${state} pull requests found.` }] };
      }
      const list = filtered.map(pr =>
        `- #${pr.number} - ${pr.title}\n  Author: ${pr.user?.login} | Base: ${pr.base.ref} <- ${pr.head.ref} | Updated: ${pr.updated_at}`
      ).join("\n\n");
      return { content: [{ type: "text", text: `${state.toUpperCase()} Pull Requests in ${owner}/${repo}:\n\n${list}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

server.tool(
  "get_pull_request",
  "Retrieves full details of a GitHub pull request including description, changed files, and review comments.",
  {
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    pr_number: z.number().int().describe("Pull request number"),
  },
  async ({ owner, repo, pr_number }) => {
    try {
      const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: pr_number });
      const { data: files } = await octokit.pulls.listFiles({ owner, repo, pull_number: pr_number });
      const { data: reviews } = await octokit.pulls.listReviews({ owner, repo, pull_number: pr_number });
      const fileList = files.map(f => `  ${f.status.padEnd(10)} ${f.filename} (+${f.additions}/-${f.deletions})`).join("\n");
      const reviewList = reviews.length > 0 ? reviews.map(r => `  ${r.user?.login}: ${r.state}`).join("\n") : "  (no reviews yet)";
      const text = [
        `PR #${pr.number}: ${pr.title}`,
        `Author: ${pr.user?.login} | State: ${pr.state} | Draft: ${pr.draft ? "Yes" : "No"}`,
        `Base: ${pr.base.ref} <- Head: ${pr.head.ref}`,
        `Changed files: ${files.length} | Commits: ${pr.commits} | Comments: ${pr.comments}`,
        `\nDescription:\n${pr.body ?? "(no description)"}`,
        `\nChanged Files:\n${fileList}`,
        `\nReviews:\n${reviewList}`,
        `\nURL: ${pr.html_url}`,
      ].join("\n");
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

server.tool(
  "add_pr_comment",
  "Posts a comment on a GitHub pull request.",
  {
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    pr_number: z.number().int().describe("Pull request number"),
    body: z.string().describe("Comment text (Markdown supported)"),
  },
  async ({ owner, repo, pr_number, body }) => {
    try {
      const { data } = await octokit.issues.createComment({ owner, repo, issue_number: pr_number, body });
      return { content: [{ type: "text", text: `Comment posted successfully.\nURL: ${data.html_url}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

server.tool(
  "list_issues",
  "Lists issues in a repository, with optional filters by state and labels.",
  {
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    state: z.enum(["open", "closed", "all"]).optional().default("open").describe("Issue state filter"),
    labels: z.string().optional().describe("Comma-separated list of label names to filter by"),
  },
  async ({ owner, repo, state, labels }) => {
    try {
      const { data } = await octokit.issues.listForRepo({ owner, repo, state, labels, per_page: 30 });
      const issues = data.filter(i => !i.pull_request);
      if (issues.length === 0) return { content: [{ type: "text", text: `No ${state} issues found.` }] };
      const list = issues.map(i =>
        `- #${i.number} - ${i.title}\n  Author: ${i.user?.login} | Labels: ${i.labels.map(l => l.name).join(", ") || "none"} | Updated: ${i.updated_at}`
      ).join("\n\n");
      return { content: [{ type: "text", text: `${state.toUpperCase()} Issues in ${owner}/${repo}:\n\n${list}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

server.tool(
  "create_issue",
  "Creates a new issue in a GitHub repository.",
  {
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    title: z.string().describe("Issue title"),
    body: z.string().optional().describe("Issue description (Markdown supported)"),
    labels: z.array(z.string()).optional().describe("List of label names to attach"),
  },
  async ({ owner, repo, title, body, labels }) => {
    try {
      const { data } = await octokit.issues.create({ owner, repo, title, body, labels });
      return { content: [{ type: "text", text: `Issue #${data.number} created successfully.\nTitle: ${data.title}\nURL: ${data.html_url}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// --- RESOURCES ---

server.resource(
  "repo-readme",
  new ResourceTemplate("github://{owner}/{repo}/readme", { list: undefined }),
  async (uri, { owner, repo }) => {
    try {
      const { data } = await octokit.repos.getReadme({ owner: String(owner), repo: String(repo) });
      const content = Buffer.from(data.content, "base64").toString("utf-8");
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: content }] };
    } catch (err) {
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: `Error fetching README: ${err.message}` }] };
    }
  }
);

server.resource(
  "repo-commits",
  new ResourceTemplate("github://{owner}/{repo}/commits", { list: undefined }),
  async (uri, { owner, repo }) => {
    try {
      const { data } = await octokit.repos.listCommits({ owner: String(owner), repo: String(repo), per_page: 20 });
      const log = data.map(c =>
        `${c.sha.slice(0, 7)} - ${c.commit.message.split("\n")[0]} (${c.commit.author?.name}, ${c.commit.author?.date})`
      ).join("\n");
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: `Recent commits in ${owner}/${repo}:\n\n${log}` }] };
    } catch (err) {
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: `Error: ${err.message}` }] };
    }
  }
);

// --- PROMPTS ---

server.prompt(
  "code_review",
  "Activates a structured, senior-developer code review mode for a pull request.",
  { owner: z.string(), repo: z.string(), pr_number: z.number().int() },
  async ({ owner, repo, pr_number }) => ({
    messages: [
      { role: "user", content: { type: "text", text: `Please review PR #${pr_number} in ${owner}/${repo}.` } },
      { role: "assistant", content: { type: "text", text: "I will review this PR as a senior developer, evaluating:\n1. Code correctness and edge cases\n2. Security implications\n3. Performance considerations\n4. Code style and maintainability\n5. Test coverage\n\nLet me start by fetching the pull request details..." } }
    ]
  })
);

server.prompt(
  "issue_triage",
  "Activates an issue triage mode to classify and prioritize open issues in a repository.",
  { owner: z.string(), repo: z.string() },
  async ({ owner, repo }) => ({
    messages: [
      { role: "user", content: { type: "text", text: `Please triage the open issues in ${owner}/${repo}.` } },
      { role: "assistant", content: { type: "text", text: "I will triage the open issues, classifying each by:\n- Priority: Critical / High / Medium / Low\n- Type: Bug / Feature / Enhancement / Question / Docs\n- Suggested labels and next actions\n\nFetching open issues now..." } }
    ]
  })
);

// --- START ---

const transport = new StdioServerTransport();
await server.connect(transport);
