import type { GraphRefOptData } from '@gitkraken/gitkraken-components';
import { refTypes } from '@gitkraken/gitkraken-components';
import { consume } from '@lit/context';
import { computed, SignalWatcher } from '@lit-labs/signals';
import type { PropertyValues } from 'lit';
import { html, LitElement } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { cache } from 'lit/directives/cache.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import type { BranchGitCommandArgs } from '../../../../commands/git/branch';
import type { GraphBranchesVisibility } from '../../../../config';
import type { SearchQuery } from '../../../../constants.search';
import { isSubscriptionPaid } from '../../../../plus/gk/utils/subscription.utils';
import type { LaunchpadCommandArgs } from '../../../../plus/launchpad/launchpad';
import { createCommandLink } from '../../../../system/commands';
import { debounce } from '../../../../system/decorators/debounce';
import { createWebviewCommandLink } from '../../../../system/webview';
import type {
	GraphExcludedRef,
	GraphExcludeTypes,
	GraphMinimapMarkerTypes,
	GraphSearchResults,
	State,
	UpdateGraphConfigurationParams,
} from '../../../plus/graph/protocol';
import {
	ChooseRefRequest,
	ChooseRepositoryCommand,
	EnsureRowRequest,
	OpenPullRequestDetailsCommand,
	SearchOpenInViewCommand,
	SearchRequest,
	UpdateExcludeTypesCommand,
	UpdateGraphConfigurationCommand,
	UpdateGraphSearchModeCommand,
	UpdateIncludedRefsCommand,
	UpdateRefsVisibilityCommand,
} from '../../../plus/graph/protocol';
import type { RadioGroup } from '../../shared/components/radio/radio-group';
import type { RepoButtonGroupClickEvent } from '../../shared/components/repo-button-group';
import type { GlSearchBox } from '../../shared/components/search/search-box';
import type { SearchNavigationEventDetail } from '../../shared/components/search/search-input';
import { inlineCode } from '../../shared/components/styles/lit/base.css';
import { ipcContext } from '../../shared/contexts/ipc';
import type { TelemetryContext } from '../../shared/contexts/telemetry';
import { telemetryContext } from '../../shared/contexts/telemetry';
import { emitTelemetrySentEvent } from '../../shared/telemetry';
import { ruleStyles } from '../shared/components/vscode.css';
import { graphStateContext } from './stateProvider';
import { actionButton, linkBase } from './styles/graph.css';
import { graphHeaderControlStyles, progressStyles, repoHeaderStyles, titlebarStyles } from './styles/header.css';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import '@shoelace-style/shoelace/dist/components/select/select.js';
import '../../shared/components/button';
import '../../shared/components/checkbox/checkbox';
import '../../shared/components/code-icon';
import '../../shared/components/menu/menu-divider';
import '../../shared/components/menu/menu-item';
import '../../shared/components/menu/menu-label';
import '../../shared/components/overlays/popover';
import '../../shared/components/overlays/tooltip';
import '../../shared/components/radio/radio';
import '../../shared/components/radio/radio-group';
import '../../shared/components/ref-button';
import '../../shared/components/repo-button-group';
import '../../shared/components/rich/issue-pull-request';
import '../../shared/components/search/search-box';
import '../shared/components/merge-rebase-status';
import './actions/gitActionsButtons';

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-header': GlGraphHeader;
	}

	interface GlobalEventHandlersEventMap {
		'gl-select-commits': CustomEvent<string>;
	}
}

function getRemoteIcon(type: number | string) {
	switch (type) {
		case 'head':
			return 'vm';
		case 'remote':
			return 'cloud';
		case 'tag':
			return 'tag';
		default:
			return '';
	}
}

function getSearchResultIdByIndex(results: GraphSearchResults, index: number): string | undefined {
	// Loop through the search results without using Object.entries or Object.keys and return the id at the specified index
	const { ids } = results;
	for (const id in ids) {
		if (!Object.hasOwn(ids, id)) continue;

		if (ids[id].i === index) return id;
	}
	return undefined;
}

@customElement('gl-graph-header')
export class GlGraphHeader extends SignalWatcher(LitElement) {
	static override styles = [
		inlineCode,
		linkBase,
		ruleStyles,
		actionButton,
		titlebarStyles,
		repoHeaderStyles,
		graphHeaderControlStyles,
		progressStyles,
	];

	// FIXME: remove light DOM
	// protected override createRenderRoot(): HTMLElement | DocumentFragment {
	// 	return this;
	// }

	@consume({ context: ipcContext })
	_ipc!: typeof ipcContext.__context__;

	@consume({ context: telemetryContext as { __context__: TelemetryContext } })
	_telemetry!: TelemetryContext;

	@consume({ context: graphStateContext, subscribe: true })
	graphState!: typeof graphStateContext.__context__;

	@state() private aiAllowed = true;

	get hasFilters() {
		if (this.graphState.config?.onlyFollowFirstParent) return true;
		if (this.graphState.excludeTypes == null) return false;

		return Object.values(this.graphState.excludeTypes).includes(true);
	}

	get excludeRefs() {
		return Object.values(this.graphState.excludeRefs ?? {}).sort(compareGraphRefOpts);
	}

	override updated(changedProperties: PropertyValues): void {
		this.aiAllowed = (this.graphState.config?.aiEnabled ?? true) && (this.graphState.orgSettings?.ai ?? true);
		super.updated(changedProperties);
	}

	private async onJumpToRefPromise(alt: boolean): Promise<{ name: string; sha: string } | undefined> {
		try {
			// Assuming we have a command to get the ref details
			const rsp = await this._ipc.sendRequest(ChooseRefRequest, { alt: alt });
			this._telemetry.sendEvent({ name: 'graph/action/jumpTo', data: { alt: alt } });
			return rsp;
		} catch {
			return undefined;
		}
	}

	private async handleJumpToRef(e: MouseEvent) {
		const ref = await this.onJumpToRefPromise(e.altKey);
		if (ref != null) {
			const sha = await this.ensureSearchResultRow(ref.sha);
			if (sha == null) return;

			this.dispatchEvent(new CustomEvent('gl-select-commits', { detail: sha }));
		}
	}

	private onOpenPullRequest(pr: NonNullable<NonNullable<State['branchState']>['pr']>): void {
		this._ipc.sendCommand(OpenPullRequestDetailsCommand, { id: pr.id });
	}

	private onSearchOpenInView() {
		this._ipc.sendCommand(SearchOpenInViewCommand, { search: { ...this.graphState.filter } });
	}

	private onExcludeTypesChanged(key: keyof GraphExcludeTypes, value: boolean) {
		this._ipc.sendCommand(UpdateExcludeTypesCommand, { key: key, value: value });
	}

	private onRefIncludesChanged(branchesVisibility: GraphBranchesVisibility, refs?: GraphRefOptData[]) {
		this._ipc.sendCommand(UpdateIncludedRefsCommand, { branchesVisibility: branchesVisibility, refs: refs });
	}

	private _activeRowInfoCache: { row: string; info: { date: number; id: string } } | undefined;

	private getActiveRowInfo(): { date: number; id: string } | undefined {
		const { activeRow } = this.graphState;
		if (activeRow == null) return undefined;
		if (this._activeRowInfoCache?.row === activeRow) return this._activeRowInfoCache?.info;

		const index = activeRow.indexOf('|');

		const info = { date: Number(activeRow.substring(index + 1)), id: activeRow.substring(0, index) };
		this._activeRowInfoCache = { row: activeRow, info: info };
		return info;
	}

	private getNextOrPreviousSearchResultIndex(
		index: number,
		next: boolean,
		results: GraphSearchResults,
		query: SearchQuery | undefined,
	) {
		if (next) {
			if (index < results.count - 1) {
				index++;
			} else if (query != null && results.paging?.hasMore) {
				index = -1; // Indicates a boundary that we should load more results
			} else {
				index = 0;
			}
		} else if (index > 0) {
			index--;
		} else if (query != null && results.paging?.hasMore) {
			index = -1; // Indicates a boundary that we should load more results
		} else {
			index = results.count - 1;
		}
		return index;
	}

	private getClosestSearchResultIndex(
		results: GraphSearchResults,
		query: SearchQuery | undefined,
		next: boolean = true,
	): { index: number; id: string | undefined } {
		if (results.ids == null) return { index: 0, id: undefined };

		const activeInfo = this.getActiveRowInfo();
		const activeId = activeInfo?.id;
		if (activeId == null) return { index: 0, id: undefined };

		let index: number | undefined;
		let nearestId: string | undefined;
		let nearestIndex: number | undefined;

		const data = results.ids[activeId];
		if (data != null) {
			index = data.i;
			nearestId = activeId;
			nearestIndex = index;
		}

		if (index == null) {
			const activeDate = activeInfo?.date != null ? activeInfo.date + (next ? 1 : -1) : undefined;
			if (activeDate == null) return { index: 0, id: undefined };

			// Loop through the search results and:
			//  try to find the active id
			//  if next=true find the nearest date before the active date
			//  if next=false find the nearest date after the active date

			let date;
			let entry;
			let i;
			let nearestDate: number | undefined;

			const { ids } = results;
			for (const id in ids) {
				if (!Object.hasOwn(ids, id)) continue;

				entry = ids[id];
				({ date, i } = entry);

				if (next) {
					if (date < activeDate && (nearestDate == null || date > nearestDate)) {
						nearestId = id;
						nearestDate = date;
						nearestIndex = i;
					}
				} else if (date > activeDate && (nearestDate == null || date <= nearestDate)) {
					nearestId = id;
					nearestDate = date;
					nearestIndex = i;
				}
			}

			index = nearestIndex == null ? results.count - 1 : nearestIndex + (next ? -1 : 1);
		}

		index = this.getNextOrPreviousSearchResultIndex(index, next, results, query);

		return index === nearestIndex ? { index: index, id: nearestId } : { index: index, id: undefined };
	}

	private _searchPositionSignal = computed(() => {
		const { searchResults } = this.graphState;
		if (searchResults?.ids == null || !this.graphState.filter.query) return 0;

		const id = this.getActiveRowInfo()?.id;
		let searchIndex = id ? searchResults.ids[id]?.i : undefined;
		if (searchIndex == null) {
			({ index: searchIndex } = this.getClosestSearchResultIndex(searchResults, { ...this.graphState.filter }));
		}
		return searchIndex < 1 ? 1 : searchIndex + 1;
	});

	private get searchPosition(): number {
		return this._searchPositionSignal.get();
	}

	get searchValid() {
		return this.graphState.filter.query.length > 2;
	}

	handleFilterChange(e: CustomEvent) {
		const $el = e.target as HTMLInputElement;
		if ($el == null) return;

		const { checked } = $el;

		switch ($el.value) {
			case 'mergeCommits':
				this.changeGraphConfiguration({ dimMergeCommits: checked });
				break;

			case 'onlyFollowFirstParent':
				this.changeGraphConfiguration({ onlyFollowFirstParent: checked });
				break;

			case 'remotes':
			case 'stashes':
			case 'tags': {
				const key = $el.value satisfies keyof GraphExcludeTypes;
				const currentFilter = this.graphState.excludeTypes?.[key];
				if ((currentFilter == null && checked) || (currentFilter != null && currentFilter !== checked)) {
					this.onExcludeTypesChanged(key, checked);
				}
				break;
			}
		}
	}

	handleOnToggleRefsVisibilityClick(_event: any, refs: GraphExcludedRef[], visible: boolean) {
		this._ipc.sendCommand(UpdateRefsVisibilityCommand, { refs: refs, visible: visible });
	}

	handleBranchesVisibility(e: CustomEvent) {
		const $el = e.target as HTMLSelectElement;
		if ($el == null) return;
		this.onRefIncludesChanged($el.value as GraphBranchesVisibility);
	}

	async handleSearch() {
		this.graphState.searching = this.searchValid;
		if (!this.searchValid) {
			this.graphState.searchResultsResponse = undefined;
		}

		try {
			const rsp = await this._ipc.sendRequest(SearchRequest, {
				search: this.searchValid ? { ...this.graphState.filter } : undefined /*limit: options?.limit*/,
			});

			if (rsp.search && rsp.results) {
				this.searchEl.logSearch(rsp.search);
			}

			this.graphState.searchResultsResponse = rsp.results;
			if (rsp.selectedRows != null) {
				this.graphState.selectedRows = rsp.selectedRows;
			}
		} catch {
			this.graphState.searchResultsResponse = undefined;
		}
		this.graphState.searching = false;
	}

	@debounce(250)
	private handleSearchInput(e: CustomEvent<SearchQuery>) {
		this.graphState.filter = e.detail;
		void this.handleSearch();
	}

	private async onSearchPromise(search: SearchQuery, options?: { limit?: number; more?: boolean }) {
		try {
			const rsp = await this._ipc.sendRequest(SearchRequest, {
				search: search,
				limit: options?.limit,
				more: options?.more,
			});

			this.graphState.searchResultsResponse = rsp.results;
			if (rsp.selectedRows != null) {
				this.graphState.selectedRows = rsp.selectedRows;
			}

			return rsp;
		} catch {
			return undefined;
		}
	}

	private async handleSearchNavigation(e: CustomEvent<SearchNavigationEventDetail>) {
		let { searchResults } = this.graphState;
		if (searchResults == null) return;

		const direction = e.detail?.direction ?? 'next';

		let count = searchResults.count;

		let searchIndex;
		let id: string | undefined;

		let next;
		if (direction === 'first') {
			next = false;
			searchIndex = 0;
		} else if (direction === 'last') {
			next = false;
			searchIndex = -1;
		} else {
			next = direction === 'next';
			({ index: searchIndex, id } = this.getClosestSearchResultIndex(
				searchResults,
				{ ...this.graphState.filter },
				next,
			));
		}

		let iterations = 0;
		// Avoid infinite loops
		while (iterations < 1000) {
			iterations++;

			// Indicates a boundary and we need to load more results
			if (searchIndex === -1) {
				if (next) {
					if (this.graphState.filter.query && searchResults?.paging?.hasMore) {
						this.graphState.searching = true;
						let moreResults;
						try {
							moreResults = await this.onSearchPromise?.({ ...this.graphState.filter }, { more: true });
						} finally {
							this.graphState.searching = false;
						}
						if (moreResults?.results != null && !('error' in moreResults.results)) {
							if (count < moreResults.results.count) {
								searchResults = moreResults.results;
								searchIndex = count;
								count = searchResults.count;
							} else {
								searchIndex = 0;
							}
						} else {
							searchIndex = 0;
						}
					} else {
						searchIndex = 0;
					}
					// this.graphState.filter != null seems noop
				} else if (direction === 'last' && this.graphState.filter != null && searchResults?.paging?.hasMore) {
					this.graphState.searching = true;
					let moreResults;
					try {
						moreResults = await this.onSearchPromise(
							{ ...this.graphState.filter },
							{ limit: 0, more: true },
						);
					} finally {
						this.graphState.searching = false;
					}
					if (moreResults?.results != null && !('error' in moreResults.results)) {
						if (count < moreResults.results.count) {
							searchResults = moreResults.results;
							count = searchResults.count;
						}
						searchIndex = count;
					}
				} else {
					searchIndex = count - 1;
				}
			}

			id = id ?? getSearchResultIdByIndex(searchResults, searchIndex);
			if (id != null) {
				id = await this.ensureSearchResultRow(id);
				if (id != null) break;
			}

			this.graphState.searchResultsHidden = true;

			searchIndex = this.getNextOrPreviousSearchResultIndex(searchIndex, next, searchResults, {
				...this.graphState.filter,
			});
		}

		if (id != null) {
			this.dispatchEvent(new CustomEvent('gl-select-commits', { detail: id }));
		}
	}

	private async onEnsureRowPromise(id: string, select: boolean) {
		try {
			return await this._ipc.sendRequest(EnsureRowRequest, { id: id, select: select });
		} catch {
			return undefined;
		}
	}

	private readonly ensuredIds = new Set<string>();
	private readonly ensuredSkippedIds = new Set<string>();
	private readonly pendingEnsureRequests = new Map<string, Promise<string | undefined>>();

	private async ensureSearchResultRow(id: string): Promise<string | undefined> {
		if (this.ensuredIds.has(id)) return id;
		if (this.ensuredSkippedIds.has(id)) return undefined;

		let promise = this.pendingEnsureRequests.get(id);
		if (promise == null) {
			let timeout: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
				timeout = undefined;
				this.graphState.loading = true;
			}, 500);

			const ensureCore = async () => {
				const e = await this.onEnsureRowPromise(id, false);
				if (timeout == null) {
					this.graphState.loading = false;
				} else {
					clearTimeout(timeout);
				}

				if (e?.id === id) {
					this.ensuredIds.add(id);
					return id;
				}

				if (e != null) {
					this.ensuredSkippedIds.add(id);
				}
				return undefined;
			};

			promise = ensureCore();
			void promise.finally(() => this.pendingEnsureRequests.delete(id));

			this.pendingEnsureRequests.set(id, promise);
		}

		return promise;
	}

	handleSearchModeChanged(e: CustomEvent) {
		this._ipc.sendCommand(UpdateGraphSearchModeCommand, {
			searchMode: e.detail.searchMode,
			useNaturalLanguage: e.detail.useNaturalLanguage,
		});
	}

	handleMinimapToggled() {
		this.changeGraphConfiguration({ minimap: !this.graphState.config?.minimap });
	}

	private changeGraphConfiguration(changes: UpdateGraphConfigurationParams['changes']) {
		this._ipc.sendCommand(UpdateGraphConfigurationCommand, { changes: changes });
	}

	private handleMinimapDataTypeChanged(e: Event) {
		if (this.graphState.config == null) return;

		const $el = e.target as RadioGroup;
		const minimapDataType = $el.value === 'lines' ? 'lines' : 'commits';
		if (this.graphState.config.minimapDataType === minimapDataType) return;

		this.changeGraphConfiguration({ minimapDataType: minimapDataType });
	}

	private handleMinimapAdditionalTypesChanged(e: Event) {
		if (this.graphState.config?.minimapMarkerTypes == null) return;

		const $el = e.target as HTMLInputElement;
		const value = $el.value as GraphMinimapMarkerTypes;

		if ($el.checked) {
			if (!this.graphState.config.minimapMarkerTypes.includes(value)) {
				const minimapMarkerTypes = [...this.graphState.config.minimapMarkerTypes, value];
				this.changeGraphConfiguration({ minimapMarkerTypes: minimapMarkerTypes });
			}
		} else {
			const index = this.graphState.config.minimapMarkerTypes.indexOf(value);
			if (index !== -1) {
				const minimapMarkerTypes = [...this.graphState.config.minimapMarkerTypes];
				minimapMarkerTypes.splice(index, 1);
				this.changeGraphConfiguration({ minimapMarkerTypes: minimapMarkerTypes });
			}
		}
	}

	@debounce(250)
	private onRepositorySelectorClicked(e: CustomEvent<RepoButtonGroupClickEvent>) {
		switch (e.detail.part) {
			case 'label':
				this._ipc.sendCommand(ChooseRepositoryCommand);
				break;

			case 'icon':
				emitTelemetrySentEvent<'graph/action/openRepoOnRemote'>(e.target!, {
					name: 'graph/action/openRepoOnRemote',
					data: {},
				});
				break;
		}
	}

	@query('gl-search-box')
	private readonly searchEl!: GlSearchBox;

	override render() {
		const repo = this.graphState.repositories?.find(repo => repo.id === this.graphState.selectedRepository);
		const { searchResults } = this.graphState;

		const hasMultipleRepositories = (this.graphState.repositories?.length ?? 0) > 1;

		return cache(
			html`<header class="titlebar graph-app__header">
				<div class="titlebar__row titlebar__row--wrap">
					<div class="titlebar__group">
						<gl-repo-button-group
							?disabled=${this.graphState.loading || !hasMultipleRepositories}
							?hasMultipleRepositories=${hasMultipleRepositories}
							.repository=${repo}
							.source=${{ source: 'graph' } as const}
							@gl-click=${this.onRepositorySelectorClicked}
							><span slot="tooltip">
								Switch to Another Repository...
								<hr />
								${repo?.name}
							</span></gl-repo-button-group
						>
						${when(
							this.graphState.allowed && repo,
							() => html`
								<span><code-icon icon="chevron-right"></code-icon></span>${when(
									this.graphState.branchState?.pr,
									pr => html`
										<gl-popover placement="bottom">
											<button slot="anchor" type="button" class="action-button">
												<issue-pull-request
													type="pr"
													identifier=${`#${pr.id}`}
													status=${pr.state}
													compact
												></issue-pull-request>
											</button>
											<div slot="content">
												<issue-pull-request
													type="pr"
													name=${pr.title}
													url=${pr.url}
													identifier=${`#${pr.id}`}
													status=${pr.state}
													.date=${pr.updatedDate}
													.dateFormat=${this.graphState.config?.dateFormat}
													.dateStyle=${this.graphState.config?.dateStyle}
													details
													@gl-issue-pull-request-details=${() => {
														this.onOpenPullRequest(pr);
													}}
												>
												</issue-pull-request>
											</div>
										</gl-popover>
									`,
								)}
								<gl-ref-button
									href=${createWebviewCommandLink(
										'gitlens.graph.switchToAnotherBranch',
										this.graphState.webviewId,
										this.graphState.webviewInstanceId,
									)}
									icon
									.ref=${this.graphState.branch}
									?worktree=${this.graphState.branchState?.worktree}
								>
									<div slot="tooltip">
										Switch Branch...
										<hr />
										<code-icon icon="git-branch" aria-hidden="true"></code-icon>
										<span class="inline-code">${this.graphState.branch?.name}</span>${when(
											this.graphState.branchState?.worktree,
											() => html`<i> (in a worktree)</i> `,
										)}
									</div>
								</gl-ref-button>
								<gl-button class="jump-to-ref" appearance="toolbar" @click=${this.handleJumpToRef}>
									<code-icon icon="target"></code-icon>
									<span slot="tooltip">
										Jump to HEAD
										<br />
										[Alt] Jump to Reference...
									</span>
								</gl-button>
								<span>
									<code-icon icon="chevron-right"></code-icon>
								</span>
								<gl-git-actions-buttons
									.branchName=${this.graphState.branch?.name}
									.branchState=${this.graphState.branchState}
									.lastFetched=${this.graphState.lastFetched}
									.state=${this.graphState}
								></gl-git-actions-buttons>
							`,
						)}
					</div>
					<div class="titlebar__group">
						<gl-tooltip placement="bottom">
							<a
								class="action-button"
								href=${createCommandLink<BranchGitCommandArgs>('gitlens.gitCommands.branch', {
									state: {
										subcommand: 'create',
										reference: this.graphState.branch,
									},
									command: 'branch',
									confirm: true,
								})}
							>
								<code-icon class="action-button__icon" icon="custom-start-work"></code-icon>
							</a>
							<span slot="content">
								Create New Branch from
								<code-icon icon="git-branch"></code-icon>
								<span class="inline-code">${this.graphState.branch?.name}</span>
							</span>
						</gl-tooltip>
						<gl-tooltip placement="bottom">
							<a
								href=${`command:gitlens.showLaunchpad?${encodeURIComponent(
									JSON.stringify({
										source: 'graph',
									} satisfies Omit<LaunchpadCommandArgs, 'command'>),
								)}`}
								class="action-button"
							>
								<code-icon icon="rocket"></code-icon>
							</a>
							<span slot="content">
								<strong>Launchpad</strong> &mdash; organizes your pull requests into actionable groups
								to help you focus and keep your team unblocked
							</span>
						</gl-tooltip>
						<gl-tooltip placement="bottom">
							<a
								href=${createWebviewCommandLink(
									'gitlens.visualizeHistory.repo:graph',
									this.graphState.webviewId,
									this.graphState.webviewInstanceId,
								)}
								class="action-button"
								aria-label=${`Open Visual History`}
							>
								<span>
									<code-icon
										class="action-button__icon"
										icon=${'graph-scatter'}
										aria-hidden="true"
									></code-icon>
								</span>
							</a>
							<span slot="content">
								<strong>Visual History</strong> — visualize the evolution of a repository, branch,
								folder, or file and identify when the most impactful changes were made and by whom
							</span>
						</gl-tooltip>
						<gl-tooltip placement="bottom">
							<a
								href=${'command:gitlens.showHomeView'}
								class="action-button"
								aria-label=${`Open GitLens Home View`}
							>
								<span>
									<code-icon
										class="action-button__icon"
										icon=${'gl-gitlens'}
										aria-hidden="true"
									></code-icon>
								</span>
							</a>
							<span slot="content">
								<strong>GitLens Home</strong> — track, manage, and collaborate on your branches and pull
								requests, all in one intuitive hub
							</span>
						</gl-tooltip>
						${when(
							this.graphState.subscription == null || !isSubscriptionPaid(this.graphState.subscription),
							() => html`
								<gl-feature-badge
									.source=${{ source: 'graph', detail: 'badge' } as const}
									.subscription=${this.graphState.subscription}
								></gl-feature-badge>
							`,
						)}
					</div>
				</div>

				${when(
					this.graphState.allowed &&
						this.graphState.workingTreeStats != null &&
						(this.graphState.workingTreeStats.hasConflicts ||
							this.graphState.workingTreeStats.pausedOpStatus),
					() => html`
						<div class="merge-conflict-warning">
							<gl-merge-rebase-status
								class="merge-conflict-warning__content"
								?conflicts=${this.graphState.workingTreeStats?.hasConflicts}
								.pausedOpStatus=${this.graphState.workingTreeStats?.pausedOpStatus}
								skipCommand="gitlens.graph.skipPausedOperation"
								continueCommand="gitlens.graph.continuePausedOperation"
								abortCommand="gitlens.graph.abortPausedOperation"
								openEditorCommand="gitlens.graph.openRebaseEditor"
								.webviewCommandContext=${{
									webview: this.graphState.webviewId,
									webviewInstance: this.graphState.webviewInstanceId,
								}}
							></gl-merge-rebase-status>
						</div>
					`,
				)}
				${when(
					this.graphState.allowed,
					() => html`
						<div class="titlebar__row">
							<div class="titlebar__group">
								<gl-tooltip placement="top" content="Branches Visibility">
									<sl-select
										value=${ifDefined(this.graphState.branchesVisibility)}
										@sl-change=${this.handleBranchesVisibility}
										hoist
									>
										<code-icon icon="chevron-down" slot="expand-icon"></code-icon>
										<sl-option value="all" ?disabled=${repo?.virtual}> All Branches </sl-option>
										<sl-option value="smart" ?disabled=${repo?.virtual}>
											Smart Branches
											${when(
												!repo?.virtual,
												() => html`
													<gl-tooltip placement="right" slot="suffix">
														<code-icon icon="info"></code-icon>
														<span slot="content">
															Shows only relevant branches
															<br />
															<br />
															<i
																>Includes the current branch, its upstream, and its base
																or target branch</i
															>
														</span>
													</gl-tooltip>
												`,
												() => html` <code-icon icon="info" slot="suffix"></code-icon> `,
											)}
										</sl-option>
										<sl-option value="favorited" ?disabled=${repo?.virtual}>
											Favorited Branches
											<gl-tooltip placement="right" slot="suffix">
												<code-icon icon="info"></code-icon>
												<span slot="content">
													Shows only branches that have been starred as favorites
													<br />
													<br />
													<i>Also includes the current branch</i>
												</span>
											</gl-tooltip>
										</sl-option>
										<sl-option value="current">Current Branch</sl-option>
									</sl-select>
								</gl-tooltip>
								<div
									class=${`shrink ${!Object.values(this.graphState.excludeRefs ?? {}).length && 'hidden'}`}
								>
									<gl-popover
										class="popover"
										placement="bottom-start"
										trigger="click focus"
										?arrow=${false}
										distance=${0}
									>
										<gl-tooltip placement="top" slot="anchor">
											<button type="button" id="hiddenRefs" class="action-button">
												<code-icon icon=${`eye-closed`}></code-icon>
												${Object.values(this.graphState.excludeRefs ?? {}).length}
												<code-icon
													class="action-button__more"
													icon="chevron-down"
													aria-hidden="true"
												></code-icon>
											</button>
											<span slot="content">Hidden Branches / Tags</span>
										</gl-tooltip>
										<div slot="content">
											<menu-label>Hidden Branches / Tags</menu-label>
											${when(
												this.excludeRefs.length > 0,
												() => html`
													${repeat(
														this.excludeRefs,
														ref => html`
															<menu-item
																@click=${(event: CustomEvent) => {
																	this.handleOnToggleRefsVisibilityClick(
																		event,
																		[ref],
																		true,
																	);
																}}
																class="flex-gap"
															>
																${this.renderRemoteAvatarOrIcon(ref)}
																<span>${ref.name}</span>
															</menu-item>
														`,
													)}
													<menu-item
														@click=${(event: CustomEvent) => {
															this.handleOnToggleRefsVisibilityClick(
																event,
																this.excludeRefs,
																true,
															);
														}}
													>
														Show All
													</menu-item>
												`,
											)}
										</div>
									</gl-popover>
								</div>
								<gl-popover
									class="popover"
									placement="bottom-start"
									trigger="click focus"
									?arrow=${false}
									distance=${0}
								>
									<gl-tooltip placement="top" slot="anchor">
										<button type="button" class="action-button">
											<code-icon icon=${`filter${this.hasFilters ? '-filled' : ''}`}></code-icon>
											<code-icon
												class="action-button__more"
												icon="chevron-down"
												aria-hidden="true"
											></code-icon>
										</button>
										<span slot="content">Graph Filtering</span>
									</gl-tooltip>
									<div slot="content">
										<menu-label>Graph Filters</menu-label>
										${when(
											repo?.virtual !== true,
											() => html`
												<menu-item role="none">
													<gl-tooltip
														placement="right"
														content="Only follow the first parent of merge commits to provide a more linear history"
													>
														<gl-checkbox
															value="onlyFollowFirstParent"
															@gl-change-value=${this.handleFilterChange}
															?checked=${this.graphState.config?.onlyFollowFirstParent ??
															false}
														>
															Simplify Merge History
														</gl-checkbox>
													</gl-tooltip>
												</menu-item>
												<menu-divider></menu-divider>
												<menu-item role="none">
													<gl-checkbox
														value="remotes"
														@gl-change-value=${this.handleFilterChange}
														?checked=${this.graphState.excludeTypes?.remotes ?? false}
													>
														Hide Remote-only Branches
													</gl-checkbox>
												</menu-item>
												<menu-item role="none">
													<gl-checkbox
														value="stashes"
														@gl-change-value=${this.handleFilterChange}
														?checked=${this.graphState.excludeTypes?.stashes ?? false}
													>
														Hide Stashes
													</gl-checkbox>
												</menu-item>
											`,
										)}
										<menu-item role="none">
											<gl-checkbox
												value="tags"
												@gl-change-value=${this.handleFilterChange}
												?checked=${this.graphState.excludeTypes?.tags ?? false}
											>
												Hide Tags
											</gl-checkbox>
										</menu-item>
										<menu-divider></menu-divider>
										<menu-item role="none">
											<gl-checkbox
												value="mergeCommits"
												@gl-change-value=${this.handleFilterChange}
												?checked=${this.graphState.config?.dimMergeCommits ?? false}
											>
												Dim Merge Commit Rows
											</gl-checkbox>
										</menu-item>
									</div>
								</gl-popover>
								<span>
									<span class="action-divider"></span>
								</span>
								<gl-search-box
									?aiAllowed=${this.aiAllowed}
									errorMessage=${this.graphState.searchResultsError?.error ?? ''}
									?filter=${this.graphState.defaultSearchMode === 'filter'}
									?naturalLanguage=${Boolean(this.graphState.useNaturalLanguageSearch)}
									?more=${searchResults?.paging?.hasMore ?? false}
									?resultsHidden=${this.graphState.searchResultsHidden}
									?resultsLoaded=${searchResults != null}
									?searching=${this.graphState.searching}
									step=${this.searchPosition}
									total=${searchResults?.count ?? 0}
									?valid=${this.searchValid}
									value=${this.graphState.filter.query}
									@gl-search-inputchange=${this.handleSearchInput}
									@gl-search-navigate=${this.handleSearchNavigation}
									@gl-search-openinview=${this.onSearchOpenInView}
									@gl-search-modechange=${this.handleSearchModeChanged}
								></gl-search-box>
								<span>
									<span class="action-divider"></span>
								</span>
								<span class="button-group">
									<gl-tooltip placement="bottom">
										<button
											type="button"
											role="checkbox"
											class="action-button"
											aria-label="Toggle Minimap"
											aria-checked=${this.graphState.config?.minimap ?? false}
											@click=${() => this.handleMinimapToggled()}
										>
											<code-icon class="action-button__icon" icon="graph-line"></code-icon>
										</button>
										<span slot="content">Toggle Minimap</span>
									</gl-tooltip>
									<gl-popover
										class="popover"
										placement="bottom-end"
										trigger="click focus"
										?arrow=${false}
										distance=${0}
									>
										<gl-tooltip placement="top" distance=${7} slot="anchor">
											<button type="button" class="action-button" aria-label="Minimap Options">
												<code-icon
													class="action-button__more"
													icon="chevron-down"
													aria-hidden="true"
												></code-icon>
											</button>
											<span slot="content">Minimap Options</span>
										</gl-tooltip>
										<div slot="content">
											<menu-label>Minimap</menu-label>
											<menu-item role="none">
												<gl-radio-group
													value=${this.graphState.config?.minimapDataType ?? 'commits'}
													@gl-change-value=${this.handleMinimapDataTypeChanged}
												>
													<gl-radio name="minimap-datatype" value="commits">
														Commits
													</gl-radio>
													<gl-radio name="minimap-datatype" value="lines">
														Lines Changed
													</gl-radio>
												</gl-radio-group>
											</menu-item>
											<menu-divider></menu-divider>
											<menu-label>Markers</menu-label>
											<menu-item role="none">
												<gl-checkbox
													value="localBranches"
													@gl-change-value=${this.handleMinimapAdditionalTypesChanged}
													?checked=${this.graphState.config?.minimapMarkerTypes?.includes(
														'localBranches',
													) ?? false}
												>
													<span
														class="minimap-marker-swatch"
														data-marker="localBranches"
													></span>
													Local Branches
												</gl-checkbox>
											</menu-item>
											<menu-item role="none">
												<gl-checkbox
													value="remoteBranches"
													@gl-change-value=${this.handleMinimapAdditionalTypesChanged}
													?checked=${this.graphState.config?.minimapMarkerTypes?.includes(
														'remoteBranches',
													) ?? true}
												>
													<span
														class="minimap-marker-swatch"
														data-marker="remoteBranches"
													></span>
													Remote Branches
												</gl-checkbox>
											</menu-item>
											<menu-item role="none">
												<gl-checkbox
													value="pullRequests"
													@gl-change-value=${this.handleMinimapAdditionalTypesChanged}
													?checked=${this.graphState.config?.minimapMarkerTypes?.includes(
														'pullRequests',
													) ?? true}
												>
													<span
														class="minimap-marker-swatch"
														data-marker="pullRequests"
													></span>
													Pull Requests
												</gl-checkbox>
											</menu-item>
											<menu-item role="none">
												<gl-checkbox
													value="stashes"
													@gl-change-value=${this.handleMinimapAdditionalTypesChanged}
													?checked=${this.graphState.config?.minimapMarkerTypes?.includes(
														'stashes',
													) ?? false}
												>
													<span class="minimap-marker-swatch" data-marker="stashes"></span>
													Stashes
												</gl-checkbox>
											</menu-item>
											<menu-item role="none">
												<gl-checkbox
													value="tags"
													@gl-change-value=${this.handleMinimapAdditionalTypesChanged}
													?checked=${this.graphState.config?.minimapMarkerTypes?.includes(
														'tags',
													) ?? true}
												>
													<span class="minimap-marker-swatch" data-marker="tags"></span>
													Tags
												</gl-checkbox>
											</menu-item>
										</div>
									</gl-popover>
								</span>
							</div>
						</div>
					`,
				)}
				<div
					class=${`progress-container infinite${this.graphState.isBusy ? ' active' : ''}`}
					role="progressbar"
				>
					<div class="progress-bar"></div>
				</div>
			</header>`,
		);
	}

	private renderRemoteAvatarOrIcon(refOptData: GraphRefOptData) {
		if (refOptData.avatarUrl) {
			return html`<img class="branch-menu__avatar" alt=${refOptData.name} src=${refOptData.avatarUrl} />`;
		}
		return html`<code-icon class="branch-menu__icon" icon=${getRemoteIcon(refOptData.type)}></code-icon>`;
	}
}

// TODO: this should be exported by the graph library
export function compareGraphRefOpts(a: GraphRefOptData, b: GraphRefOptData): number {
	const comparationResult = a.name.localeCompare(b.name);
	if (comparationResult === 0) {
		// If names are equals
		if (a.type === refTypes.REMOTE) {
			return -1;
		}
	}
	return comparationResult;
}
