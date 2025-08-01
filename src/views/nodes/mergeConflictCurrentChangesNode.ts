import type { CancellationToken, Command } from 'vscode';
import { MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { DiffWithCommandArgs } from '../../commands/diffWith';
import { GlyphChars } from '../../constants';
import { GitUri } from '../../git/gitUri';
import type { GitCommit } from '../../git/models/commit';
import type { GitFile } from '../../git/models/file';
import type { GitPausedOperationStatus } from '../../git/models/pausedOperationStatus';
import { getReferenceLabel } from '../../git/utils/reference.utils';
import { createCommand, createCoreCommand } from '../../system/-webview/command';
import { configuration } from '../../system/-webview/configuration';
import { editorLineToDiffRange } from '../../system/-webview/vscode/editors';
import type { FileHistoryView } from '../fileHistoryView';
import type { LineHistoryView } from '../lineHistoryView';
import type { ViewsWithCommits } from '../viewBase';
import { ContextValues, ViewNode } from './abstract/viewNode';
import { getFileRevisionAsCommitTooltip } from './fileRevisionAsCommitNode';

export class MergeConflictCurrentChangesNode extends ViewNode<
	'conflict-current-changes',
	ViewsWithCommits | FileHistoryView | LineHistoryView
> {
	constructor(
		view: ViewsWithCommits | FileHistoryView | LineHistoryView,
		protected override readonly parent: ViewNode,
		private readonly status: GitPausedOperationStatus,
		private readonly file: GitFile,
	) {
		super('conflict-current-changes', GitUri.fromFile(file, status.repoPath, 'HEAD'), view, parent);
	}

	private _commit: Promise<GitCommit | undefined> | undefined;
	private async getCommit(): Promise<GitCommit | undefined> {
		this._commit ??= this.view.container.git.getRepositoryService(this.status.repoPath).commits.getCommit('HEAD');
		return this._commit;
	}

	getChildren(): ViewNode[] {
		return [];
	}

	async getTreeItem(): Promise<TreeItem> {
		const commit = await this.getCommit();

		const item = new TreeItem('Current changes', TreeItemCollapsibleState.None);
		item.contextValue = ContextValues.MergeConflictCurrentChanges;
		item.description = `${getReferenceLabel(this.status.current, { expand: false, icon: false })}${
			commit != null ? ` (${getReferenceLabel(commit, { expand: false, icon: false })})` : ' (HEAD)'
		}`;
		item.iconPath = this.view.config.avatars
			? ((await commit?.getAvatarUri({ defaultStyle: configuration.get('defaultGravatarsStyle') })) ??
				new ThemeIcon('diff'))
			: new ThemeIcon('diff');
		item.command = this.getCommand();

		return item;
	}

	override getCommand(): Command {
		if (this.status.mergeBase == null) {
			return createCoreCommand(
				'vscode.open',
				'Open Revision',
				this.view.container.git
					.getRepositoryService(this.status.repoPath)
					.getRevisionUri('HEAD', this.file.path),
			);
		}

		return createCommand<[DiffWithCommandArgs]>('gitlens.diffWith', 'Open Changes', {
			lhs: {
				sha: this.status.mergeBase,
				uri: GitUri.fromFile(this.file, this.status.repoPath, undefined, true),
				title: `${this.file.path} (merge-base)`,
			},
			rhs: {
				sha: 'HEAD',
				uri: GitUri.fromFile(this.file, this.status.repoPath),
				title: `${this.file.path} (${getReferenceLabel(this.status.current, {
					expand: false,
					icon: false,
				})})`,
			},
			repoPath: this.status.repoPath,
			range: editorLineToDiffRange(0),
			showOptions: { preserveFocus: true, preview: true },
		});
	}

	override async resolveTreeItem(item: TreeItem, token: CancellationToken): Promise<TreeItem> {
		item.tooltip ??= await this.getTooltip(token);
		return item;
	}

	private async getTooltip(cancellation: CancellationToken) {
		const commit = await this.getCommit();
		if (cancellation.isCancellationRequested) return undefined;

		const markdown = new MarkdownString(
			`Current changes on ${getReferenceLabel(this.status.current, { label: false })}\\\n$(file)${
				GlyphChars.Space
			}${this.file.path}`,
			true,
		);

		if (commit == null) return markdown;

		const tooltip = await getFileRevisionAsCommitTooltip(
			this.view.container,
			commit,
			this.file,
			this.view.config.formats.commits.tooltipWithStatus,
			{ cancellation: cancellation },
		);

		markdown.appendMarkdown(`\n\n${tooltip}`);
		markdown.isTrusted = true;

		return markdown;
	}
}
