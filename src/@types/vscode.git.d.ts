/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Command, CancellationToken, Disposable, Event, ProviderResult, Uri } from 'vscode';
import { GitErrorCodes, RefType, Status, ForcePushMode } from '../@types/vscode.git.enums';

export interface Git {
	readonly path: string;
}

export interface InputBox {
	value: string;
}

export interface Ref {
	readonly type: RefType;
	readonly name?: string;
	readonly commit?: string;
	readonly remote?: string;
}

export interface UpstreamRef {
	readonly remote: string;
	readonly name: string;
	readonly commit?: string;
}

export interface Branch extends Ref {
	readonly upstream?: UpstreamRef;
	readonly ahead?: number;
	readonly behind?: number;
}

export interface CommitShortStat {
	readonly files: number;
	readonly insertions: number;
	readonly deletions: number;
}

export interface Commit {
	readonly hash: string;
	readonly message: string;
	readonly parents: string[];
	readonly authorDate?: Date;
	readonly authorName?: string;
	readonly authorEmail?: string;
	readonly commitDate?: Date;
	readonly shortStat?: CommitShortStat;
}

export interface Submodule {
	readonly name: string;
	readonly path: string;
	readonly url: string;
}

export interface Remote {
	readonly name: string;
	readonly fetchUrl?: string;
	readonly pushUrl?: string;
	readonly isReadOnly: boolean;
}

export interface Change {
	/**
	 * Returns either `originalUri` or `renameUri`, depending
	 * on whether this change is a rename change. When
	 * in doubt always use `uri` over the other two alternatives.
	 */
	readonly uri: Uri;
	readonly originalUri: Uri;
	readonly renameUri: Uri | undefined;
	readonly status: Status;
}

export interface RepositoryState {
	readonly HEAD: Branch | undefined;
	readonly refs: Ref[];
	readonly remotes: Remote[];
	readonly submodules: Submodule[];
	readonly rebaseCommit: Commit | undefined;

	readonly mergeChanges: Change[];
	readonly indexChanges: Change[];
	readonly workingTreeChanges: Change[];
	readonly untrackedChanges: Change[];

	readonly onDidChange: Event<void>;
}

export interface RepositoryUIState {
	readonly selected: boolean;
	readonly onDidChange: Event<void>;
}

/**
 * Log options.
 */
export interface LogOptions {
	/** Max number of log entries to retrieve. If not specified, the default is 32. */
	readonly maxEntries?: number;
	readonly path?: string;
	/** A commit range, such as "0a47c67f0fb52dd11562af48658bc1dff1d75a38..0bb4bdea78e1db44d728fd6894720071e303304f" */
	readonly range?: string;
	readonly reverse?: boolean;
	readonly sortByAuthorDate?: boolean;
	readonly shortStats?: boolean;
	readonly author?: string;
	readonly refNames?: string[];
	readonly maxParents?: number;
	readonly skip?: number;
}

export interface CommitOptions {
	all?: boolean | 'tracked';
	amend?: boolean;
	signoff?: boolean;
	signCommit?: boolean;
	empty?: boolean;
	noVerify?: boolean;
	requireUserConfig?: boolean;
	useEditor?: boolean;
	verbose?: boolean;
	/**
	 * string    - execute the specified command after the commit operation
	 * undefined - execute the command specified in git.postCommitCommand
	 *             after the commit operation
	 * null      - do not execute any command after the commit operation
	 */
	postCommitCommand?: string | null;
}

export interface FetchOptions {
	remote?: string;
	ref?: string;
	all?: boolean;
	prune?: boolean;
	depth?: number;
}

export interface InitOptions {
	defaultBranch?: string;
}

export interface RefQuery {
	readonly contains?: string;
	readonly count?: number;
	readonly pattern?: string;
	readonly sort?: 'alphabetically' | 'committerdate';
}

export interface BranchQuery extends RefQuery {
	readonly remote?: boolean;
}

export interface Repository {
	readonly rootUri: Uri;
	readonly inputBox: InputBox;
	readonly state: RepositoryState;
	readonly ui: RepositoryUIState;

	readonly onDidCommit: Event<void>;

	getConfigs(): Promise<{ key: string; value: string }[]>;
	getConfig(key: string): Promise<string>;
	setConfig(key: string, value: string): Promise<string>;
	getGlobalConfig(key: string): Promise<string>;

	getObjectDetails(treeish: string, path: string): Promise<{ mode: string; object: string; size: number }>;
	detectObjectType(object: string): Promise<{ mimetype: string; encoding?: string }>;
	buffer(ref: string, path: string): Promise<Buffer>;
	show(ref: string, path: string): Promise<string>;
	getCommit(ref: string): Promise<Commit>;

	add(paths: string[]): Promise<void>;
	revert(paths: string[]): Promise<void>;
	clean(paths: string[]): Promise<void>;

	apply(patch: string, reverse?: boolean): Promise<void>;
	diff(cached?: boolean): Promise<string>;
	diffWithHEAD(): Promise<Change[]>;
	diffWithHEAD(path: string): Promise<string>;
	diffWith(ref: string): Promise<Change[]>;
	diffWith(ref: string, path: string): Promise<string>;
	diffIndexWithHEAD(): Promise<Change[]>;
	diffIndexWithHEAD(path: string): Promise<string>;
	diffIndexWith(ref: string): Promise<Change[]>;
	diffIndexWith(ref: string, path: string): Promise<string>;
	diffBlobs(object1: string, object2: string): Promise<string>;
	diffBetween(ref1: string, ref2: string): Promise<Change[]>;
	diffBetween(ref1: string, ref2: string, path: string): Promise<string>;

	hashObject(data: string): Promise<string>;

	createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
	deleteBranch(name: string, force?: boolean): Promise<void>;
	getBranch(name: string): Promise<Branch>;
	getBranches(query: BranchQuery, cancellationToken?: CancellationToken): Promise<Ref[]>;
	getBranchBase(name: string): Promise<Branch | undefined>;
	setBranchUpstream(name: string, upstream: string): Promise<void>;

	checkIgnore(paths: string[]): Promise<Set<string>>;

	getRefs(query: RefQuery, cancellationToken?: CancellationToken): Promise<Ref[]>;

	getMergeBase(ref1: string, ref2: string): Promise<string | undefined>;

	tag(name: string, upstream: string): Promise<void>;
	deleteTag(name: string): Promise<void>;

	status(): Promise<void>;
	checkout(treeish: string): Promise<void>;

	addRemote(name: string, url: string): Promise<void>;
	removeRemote(name: string): Promise<void>;
	renameRemote(name: string, newName: string): Promise<void>;

	fetch(options?: FetchOptions): Promise<void>;
	fetch(remote?: string, ref?: string, depth?: number): Promise<void>;
	pull(unshallow?: boolean): Promise<void>;
	push(remoteName?: string, branchName?: string, setUpstream?: boolean, force?: ForcePushMode): Promise<void>;

	blame(path: string): Promise<string>;
	log(options?: LogOptions): Promise<Commit[]>;

	commit(message: string, opts?: CommitOptions): Promise<void>;
	merge(ref: string): Promise<void>;
	mergeAbort(): Promise<void>;
}

export interface RemoteSource {
	readonly name: string;
	readonly description?: string;
	readonly url: string | string[];
}

export interface RemoteSourceProvider {
	readonly name: string;
	readonly icon?: string; // codicon name
	readonly supportsQuery?: boolean;
	getRemoteSources(query?: string): ProviderResult<RemoteSource[]>;
	getBranches?(url: string): ProviderResult<string[]>;
	publishRepository?(repository: Repository): Promise<void>;
}

export interface RemoteSourcePublisher {
	readonly name: string;
	readonly icon?: string; // codicon name
	publishRepository(repository: Repository): Promise<void>;
}

export interface Credentials {
	readonly username: string;
	readonly password: string;
}

export interface CredentialsProvider {
	getCredentials(host: Uri): ProviderResult<Credentials>;
}

export interface PostCommitCommandsProvider {
	getCommands(repository: Repository): Command[];
}

export interface PushErrorHandler {
	handlePushError(
		repository: Repository,
		remote: Remote,
		refspec: string,
		error: Error & { gitErrorCode: GitErrorCodes },
	): Promise<boolean>;
}

export interface BranchProtection {
	readonly remote: string;
	readonly rules: BranchProtectionRule[];
}

export interface BranchProtectionRule {
	readonly include?: string[];
	readonly exclude?: string[];
}

export interface BranchProtectionProvider {
	onDidChangeBranchProtection: Event<Uri>;
	provideBranchProtection(): BranchProtection[];
}

export type APIState = 'uninitialized' | 'initialized';

export interface PublishEvent {
	repository: Repository;
	branch?: string;
}

export interface API {
	readonly state: APIState;
	readonly onDidChangeState: Event<APIState>;
	readonly onDidPublish: Event<PublishEvent>;
	readonly git: Git;
	readonly repositories: Repository[];
	readonly onDidOpenRepository: Event<Repository>;
	readonly onDidCloseRepository: Event<Repository>;

	toGitUri(uri: Uri, ref: string): Uri;
	getRepository(uri: Uri): Repository | null;
	init(root: Uri, options?: InitOptions): Promise<Repository | null>;
	openRepository(root: Uri): Promise<Repository | null>;

	registerRemoteSourcePublisher(publisher: RemoteSourcePublisher): Disposable;
	registerRemoteSourceProvider(provider: RemoteSourceProvider): Disposable;
	registerCredentialsProvider(provider: CredentialsProvider): Disposable;
	registerPostCommitCommandsProvider(provider: PostCommitCommandsProvider): Disposable;
	registerPushErrorHandler(handler: PushErrorHandler): Disposable;
	registerBranchProtectionProvider(root: Uri, provider: BranchProtectionProvider): Disposable;
}

export interface GitExtension {
	readonly enabled: boolean;
	readonly onDidChangeEnablement: Event<boolean>;

	/**
	 * Returns a specific API version.
	 *
	 * Throws error if git extension is disabled. You can listen to the
	 * [GitExtension.onDidChangeEnablement](#GitExtension.onDidChangeEnablement) event
	 * to know when the extension becomes enabled/disabled.
	 *
	 * @param version Version number.
	 * @returns API instance
	 */
	getAPI(version: 1): API;
}
