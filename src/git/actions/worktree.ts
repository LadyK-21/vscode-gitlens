import type { Uri } from 'vscode';
import type { WorktreeGitCommandArgs } from '../../commands/git/worktree';
import { Container } from '../../container';
import type { OpenWorkspaceLocation } from '../../system/-webview/vscode/workspaces';
import { defer } from '../../system/promise';
import type { ViewNode } from '../../views/nodes/abstract/viewNode';
import type { RevealOptions } from '../../views/viewBase';
import { executeGitCommand } from '../actions';
import type { GitReference } from '../models/reference';
import type { Repository } from '../models/repository';
import type { GitWorktree } from '../models/worktree';

export async function create(
	repo?: string | Repository,
	uri?: Uri,
	ref?: GitReference,
	options?: { addRemote?: { name: string; url: string }; createBranch?: string; reveal?: boolean },
): Promise<GitWorktree | undefined> {
	const deferred = defer<GitWorktree | undefined>();

	await executeGitCommand({
		command: 'worktree',
		state: {
			subcommand: 'create',
			repo: repo,
			uri: uri,
			reference: ref,
			addRemote: options?.addRemote,
			createBranch: options?.createBranch,
			flags: options?.createBranch ? ['-b'] : undefined,
			result: deferred,
			reveal: options?.reveal,
		},
	});

	// If the result is still pending, then the command was cancelled
	if (!deferred.pending) return deferred.promise;

	deferred.cancel();
	return undefined;
}

export function copyChangesToWorktree(
	type: 'working-tree' | 'index',
	repo?: string | Repository,
	target?: GitWorktree,
	source?: GitWorktree,
): Promise<void> {
	return executeGitCommand({
		command: 'worktree',
		state: {
			subcommand: 'copy-changes',
			repo: repo,
			source: source,
			target: target,
			changes: { type: type },
		},
	});
}

export function open(
	worktree: GitWorktree,
	options?: { location?: OpenWorkspaceLocation; openOnly?: boolean },
): Promise<void> {
	return executeGitCommand({
		command: 'worktree',
		state: {
			subcommand: 'open',
			repo: worktree.repoPath,
			worktree: worktree,
			flags: convertLocationToOpenFlags(options?.location),
			openOnly: options?.openOnly,
		},
	});
}

export function remove(repo?: string | Repository, uris?: Uri[]): Promise<void> {
	return executeGitCommand({
		command: 'worktree',
		state: { subcommand: 'delete', repo: repo, uris: uris },
	});
}

export function revealWorktree(worktree: GitWorktree, options?: RevealOptions): Promise<ViewNode | undefined> {
	return Container.instance.views.revealWorktree(worktree, options);
}

type OpenFlags = Extract<
	NonNullable<Required<WorktreeGitCommandArgs['state']>>,
	{ subcommand: 'open' }
>['flags'][number];

export function convertLocationToOpenFlags(location: OpenWorkspaceLocation): OpenFlags[];
export function convertLocationToOpenFlags(location: OpenWorkspaceLocation | undefined): OpenFlags[] | undefined;
export function convertLocationToOpenFlags(location: OpenWorkspaceLocation | undefined): OpenFlags[] | undefined {
	if (location == null) return undefined;

	switch (location) {
		case 'newWindow':
			return ['--new-window'];
		case 'addToWorkspace':
			return ['--add-to-workspace'];
		case 'currentWindow':
		default:
			return [];
	}
}

export function convertOpenFlagsToLocation(flags: OpenFlags[]): OpenWorkspaceLocation;
export function convertOpenFlagsToLocation(flags: OpenFlags[] | undefined): OpenWorkspaceLocation | undefined;
export function convertOpenFlagsToLocation(flags: OpenFlags[] | undefined): OpenWorkspaceLocation | undefined {
	if (flags == null) return undefined;

	if (flags.includes('--new-window')) return 'newWindow';
	if (flags.includes('--add-to-workspace')) return 'addToWorkspace';
	return 'currentWindow';
}
