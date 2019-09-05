'use strict';
import { commands, ConfigurationChangeEvent, Event, EventEmitter } from 'vscode';
import { configuration, RepositoriesViewConfig, ViewFilesLayout, ViewsConfig } from '../configuration';
import { CommandContext, setCommandContext, WorkspaceState } from '../constants';
import { Container } from '../container';
import { RepositoriesNode, ViewNode } from './nodes';
import { ViewBase } from './viewBase';
import { ViewShowBranchComparison } from '../config';
import { CompareBranchNode } from './nodes/compareBranchNode';

export class RepositoriesView extends ViewBase<RepositoriesNode> {
	constructor() {
		super('gitlens.views.repositories', 'Repositories');
	}

	private _onDidChangeAutoRefresh = new EventEmitter<void>();
	get onDidChangeAutoRefresh(): Event<void> {
		return this._onDidChangeAutoRefresh.event;
	}

	getRoot() {
		return new RepositoriesNode(this);
	}

	protected get location(): string {
		return this.config.location;
	}

	protected registerCommands() {
		void Container.viewCommands;

		commands.registerCommand(
			this.getQualifiedCommand('copy'),
			() => commands.executeCommand('gitlens.views.copy', this.selection),
			this
		);
		commands.registerCommand(this.getQualifiedCommand('refresh'), () => this.refresh(true), this);
		commands.registerCommand(
			this.getQualifiedCommand('setFilesLayoutToAuto'),
			() => this.setFilesLayout(ViewFilesLayout.Auto),
			this
		);
		commands.registerCommand(
			this.getQualifiedCommand('setFilesLayoutToList'),
			() => this.setFilesLayout(ViewFilesLayout.List),
			this
		);
		commands.registerCommand(
			this.getQualifiedCommand('setFilesLayoutToTree'),
			() => this.setFilesLayout(ViewFilesLayout.Tree),
			this
		);

		commands.registerCommand(
			this.getQualifiedCommand('setAutoRefreshToOn'),
			() => this.setAutoRefresh(Container.config.views.repositories.autoRefresh, true),
			this
		);
		commands.registerCommand(
			this.getQualifiedCommand('setAutoRefreshToOff'),
			() => this.setAutoRefresh(Container.config.views.repositories.autoRefresh, false),
			this
		);

		commands.registerCommand(
			this.getQualifiedCommand('setBranchComparisonToWorking'),
			n => this.setBranchComparison(n, ViewShowBranchComparison.Working),
			this
		);
		commands.registerCommand(
			this.getQualifiedCommand('setBranchComparisonToBranch'),
			n => this.setBranchComparison(n, ViewShowBranchComparison.Branch),
			this
		);
	}

	protected onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (
			!configuration.changed(e, 'views', 'repositories') &&
			!configuration.changed(e, 'views') &&
			!configuration.changed(e, 'defaultDateFormat') &&
			!configuration.changed(e, 'defaultDateSource') &&
			!configuration.changed(e, 'defaultDateStyle') &&
			!configuration.changed(e, 'defaultGravatarsStyle') &&
			!configuration.changed(e, 'sortBranchesBy') &&
			!configuration.changed(e, 'sortTagsBy')
		) {
			return;
		}

		if (configuration.changed(e, 'views', 'repositories', 'autoRefresh')) {
			void this.setAutoRefresh(Container.config.views.repositories.autoRefresh);
		}

		if (configuration.changed(e, 'views', 'repositories', 'location')) {
			this.initialize(this.config.location, { showCollapseAll: true });
		}

		if (!configuration.initializing(e) && this._root !== undefined) {
			void this.refresh(true);
		}
	}

	get autoRefresh() {
		return (
			this.config.autoRefresh &&
			Container.context.workspaceState.get<boolean>(WorkspaceState.ViewsRepositoriesAutoRefresh, true)
		);
	}

	get config(): ViewsConfig & RepositoriesViewConfig {
		return { ...Container.config.views, ...Container.config.views.repositories };
	}

	private async setAutoRefresh(enabled: boolean, workspaceEnabled?: boolean) {
		if (enabled) {
			if (workspaceEnabled === undefined) {
				workspaceEnabled = Container.context.workspaceState.get<boolean>(
					WorkspaceState.ViewsRepositoriesAutoRefresh,
					true
				);
			} else {
				await Container.context.workspaceState.update(
					WorkspaceState.ViewsRepositoriesAutoRefresh,
					workspaceEnabled
				);
			}
		}

		setCommandContext(CommandContext.ViewsRepositoriesAutoRefresh, enabled && workspaceEnabled);

		this._onDidChangeAutoRefresh.fire();
	}

	private setBranchComparison(node: ViewNode, comparisonType: Exclude<ViewShowBranchComparison, false>) {
		if (!(node instanceof CompareBranchNode)) return undefined;

		return node.setComparisonType(comparisonType);
	}

	private setFilesLayout(layout: ViewFilesLayout) {
		return configuration.updateEffective('views', 'repositories', 'files', 'layout', layout);
	}
}
