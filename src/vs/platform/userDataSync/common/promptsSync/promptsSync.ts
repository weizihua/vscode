/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Event } from '../../../../base/common/event.js';
import { ILogService } from '../../../log/common/log.js';
import { assert, assertNever } from '../../../../base/common/assert.js';
import { IFileContent, IFileService } from '../../../files/common/files.js';
import { assertDefined } from '../../../../base/common/types.js';
import { IStorageService } from '../../../storage/common/storage.js';
import { ITelemetryService } from '../../../telemetry/common/telemetry.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IUriIdentityService } from '../../../uriIdentity/common/uriIdentity.js';
import { IEnvironmentService } from '../../../environment/common/environment.js';
import { IUserDataProfile } from '../../../userDataProfile/common/userDataProfile.js';
import { IConfigurationService } from '../../../configuration/common/configuration.js';
import { AbstractSynchroniser, IAcceptResult, IFileResourcePreview, IMergeResult, IResourcePreview } from '../abstractSynchronizer.js';
import { IUserDataSyncLocalStoreService, IUserDataSynchroniser, IUserDataSyncLogService, IUserDataSyncEnablementService, IUserDataSyncStoreService, SyncResource, IRemoteUserData, IUserDataSyncConfiguration, Change, USER_DATA_SYNC_SCHEME } from '../userDataSync.js';
import { CancellationError } from '../../../../base/common/errors.js';

const ADD = Change.Added;
const NONE = Change.None;

// /**
//  * TODO: @lego
//  */
// interface IPrompt {
// 	uri: URI;
// 	name: string;
// 	fileContent: IFileContent;
// }

/**
 * Reads prompt files from provided `folder`.
 * TODO: @legomushroom - use prompt service instead?
 */
const readPrompts = async (
	folder: URI,
	fileService: IFileService,
	logService: ILogService,
): Promise<readonly IFileContent[]> => {
	const result: IFileContent[] = [];

	const folderInfo = await fileService.resolve(folder);
	assert(
		folderInfo.isDirectory,
		`Path used for prompts source folder '${folder.fsPath}' is a file.`,
	);

	// a sanity check - folder object must always have `children` array
	const { children } = folderInfo;
	assertDefined(
		children,
		`Folder '${folder.fsPath}' must have children.`,
	);

	for (const child of children) {
		const { name, resource, isDirectory } = child;

		if (isDirectory) {
			continue;
		}

		try {
			assert(
				// TODO: @legomushroom - reuse common constant instead
				name.endsWith('.prompt.md'),
				`Not a prompt file`,
			);

			result.push(
				await fileService.readFile(resource),
			);
		} catch (error) {
			logService.trace(
				`Failed to read prompt file '${resource.fsPath}'.`,
			);
		}
	}

	return result;
};

/**
 * Global prompt files synchronizer.
 */
export class PromptsSynchronizer extends AbstractSynchroniser implements IUserDataSynchroniser {

	// TODO: @legomushroom - remove this
	public readonly dbg: string = 'prompts-sync';

	/**
	 * Version of settings sync server to use.
	 */
	protected readonly version: number = 1;

	/**
	 * Root folder for global prompts.
	 */
	private readonly rootFolder: URI = this.profile.promptsHome;

	constructor(
		private readonly profile: IUserDataProfile,
		collection: string | undefined,
		@IFileService fileService: IFileService,
		@IStorageService storageService: IStorageService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IUriIdentityService uriIdentityService: IUriIdentityService,
		@IUserDataSyncLogService logService: IUserDataSyncLogService,
		@IConfigurationService configurationService: IConfigurationService,
		@IUserDataSyncStoreService userDataSyncStoreService: IUserDataSyncStoreService,
		@IUserDataSyncEnablementService userDataSyncEnablementService: IUserDataSyncEnablementService,
		@IUserDataSyncLocalStoreService userDataSyncLocalStoreService: IUserDataSyncLocalStoreService,
	) {
		super({ syncResource: SyncResource.Prompts, profile }, collection, fileService, environmentService, storageService, userDataSyncStoreService, userDataSyncLocalStoreService, userDataSyncEnablementService, telemetryService, logService, configurationService, uriIdentityService);

		this._register(this.fileService.watch(environmentService.userRoamingDataHome));
		this._register(this.fileService.watch(this.rootFolder));
		this._register(Event.filter(
			this.fileService.onDidFilesChange,
			(e) => {
				return e.affects(this.rootFolder);
			})
			(() => {
				return this.triggerLocalChange();
			}));
	}

	protected override async generateSyncPreview(
		remoteUserData: IRemoteUserData,
		lastSyncUserData: IRemoteUserData | null,
		isRemoteDataFromCurrentMachine: boolean,
		userDataSyncConfiguration: IUserDataSyncConfiguration,
		token: CancellationToken,
	): Promise<IResourcePreview[]> {
		const result: IFileResourcePreview[] = [];
		const localPrompts = await readPrompts(this.rootFolder, this.fileService, this.logService);

		if (!remoteUserData.syncData) {
			result.push(
				...localPrompts.map((prompt) => {
					const { name, value } = prompt;
					const localContent = value.toString();

					return {
						fileContent: prompt,

						baseResource: this.previewResource(name, 'base'),
						baseContent: null,

						localResource: this.previewResource(name, 'local'),
						localContent,
						localChange: NONE,

						remoteResource: this.previewResource(name, 'remote'),
						remoteContent: null,
						remoteChange: ADD,

						previewResource: this.previewResource(name, 'none'),
						acceptedResource: this.previewResource(name, 'accepted'),
					};
				}),
			);

			return result;
		}

		return result;
	}

	protected override async getMergeResult(
		preview: IResourcePreview,
		token: CancellationToken,
	): Promise<IMergeResult> {
		assert(
			!token.isCancellationRequested,
			new CancellationError(),
		);

		const { localChange, remoteChange } = preview;
		const hasConflicts = (
			((localChange !== NONE) && (remoteChange !== NONE))
			&& ((localChange !== Change.Deleted) && (remoteChange !== Change.Deleted))
		);

		const content = this.calculateMergedContent(preview, hasConflicts);
		const result: IMergeResult = {
			content,
			hasConflicts,
			localChange,
			remoteChange
		};

		return result;
	}

	/**
	 * TODO: @legomushroom
	 */
	// TODO: @legomushroom - update logic here - Change['something'] is what `needs` to happen, not what have happened!
	// TODO: @legomushroom - refactor this function
	private calculateMergedContent(
		preview: IResourcePreview,
		hasConflicts: boolean,
	): string | null {
		if (hasConflicts) {
			return null;
		}

		const { localChange, remoteChange } = preview;

		if (localChange === Change.Deleted) {
			// both are deleted - no content
			if (remoteChange === Change.Deleted) {
				return null;
			}

			// there is no remote content to use
			if (remoteChange === Change.None) {
				return null;
			}

			// TODO: @legomushroom - is this correct?
			if (remoteChange === ADD) {
				return preview.remoteContent;
			}

			// sanity check - must never happen if `hasConflicts` arguments tells the truth
			assert(
				!(remoteChange === Change.Modified),
				`Conflict detected: local file is deleted, but remote file is modified.`,
			);

			assertNever(
				remoteChange,
				`Unexpected remote change '${remoteChange}'.`,
			);
		}

		if (localChange === Change.Modified) {
			// should use updated local content
			if (remoteChange === Change.Deleted) {
				return preview.localContent;
			}

			// should use updated local content
			if (remoteChange === NONE) {
				return preview.localContent;
			}

			// sanity check - must never happen if `hasConflicts` arguments tells the truth
			assert(
				!(remoteChange === ADD),
				`Conflict detected: local file is modified, but remote file is added.`,
			);

			// sanity check - must never happen if `hasConflicts` arguments tells the truth
			assert(
				!(remoteChange === Change.Modified),
				`Conflict detected: both local and remote files are modified.`,
			);

			assertNever(
				remoteChange,
				`Unexpected remote change '${remoteChange}'.`,
			);
		}

		if (localChange === ADD) {
			// TODO: @legomushroom - is this correct?
			if (remoteChange === Change.Deleted) {
				return preview.localContent;
			}

			// should use the local content
			if (remoteChange === NONE) {
				return preview.localContent;
			}

			// sanity check - must never happen if `hasConflicts` arguments tells the truth
			assert(
				!(remoteChange === ADD),
				`Conflict detected: local file is added, but remote file is added.`,
			);

			// sanity check - must never happen if `hasConflicts` arguments tells the truth
			assert(
				!(remoteChange === Change.Modified),
				`Conflict detected: local file is added, but remote file is modified.`,
			);

			assertNever(
				remoteChange,
				`Unexpected remote change '${remoteChange}'.`,
			);
		}

		if (localChange === Change.None) {
			// deleted on remote, didn't change locally
			if (remoteChange === Change.Deleted) {
				return null;
			}

			// none have changed, use whatever content available
			if (remoteChange === Change.None) {
				return preview.localContent;
			}

			// added the file on remote, use its contents
			if (remoteChange === ADD) {
				return preview.remoteContent;
			}

			// modified the file on remote, use its contents
			if (remoteChange === Change.Modified) {
				return preview.remoteContent;
			}

			assertNever(
				remoteChange,
				`Unexpected remote change '${remoteChange}'.`,
			);
		}

		assertNever(
			localChange,
			`Unexpected loca change type '${localChange}'.`,
		);
	}

	protected override async getAcceptResult(
		resourcePreview: IFileResourcePreview,
		_resource: URI,
		_content: string | null | undefined,
		token: CancellationToken,
	): Promise<IAcceptResult> {
		// TODO: @legomushroom - compute the merge result only once
		const mergeResult = await this.getMergeResult(resourcePreview, token);

		if (!mergeResult.hasConflicts) {
			return mergeResult;
		}

		throw new Error('Resolve conflicts here.');

		// if (content === undefined) {
		// 	return mergeResult;
		// }

		// if (this.authorityMatches(resource, 'local')) {
		// 	return {
		// 		content: resourcePreview.localContent,
		// 		localChange: Change.None,
		// 		remoteChange: resourcePreview.fileContent
		// 			? resourcePreview.remoteContent !== null ? Change.Modified : Change.Added
		// 			: Change.Deleted
		// 	};
		// }
	}

	protected override applyResult(
		remoteUserData: IRemoteUserData,
		lastSyncUserData: IRemoteUserData | null,
		result: [IResourcePreview, IAcceptResult][],
		force: boolean,
	): Promise<void> {
		throw new Error('Method not implemented.');
	}

	protected override hasRemoteChanged(
		lastSyncUserData: IRemoteUserData,
	): Promise<boolean> {
		throw new Error('Method not implemented.');
	}

	public override hasLocalData(): Promise<boolean> {
		throw new Error('Method not implemented.');
	}

	public override resolveContent(uri: URI): Promise<string | null> {
		throw new Error('Method not implemented.');
	}

	/**
	 * TODO: @lego
	 */
	private previewResource(
		name: string,
		authority: 'base' | 'local' | 'remote' | 'accepted' | 'none',
	): URI {
		const resource = this.extUri
			.joinPath(this.syncPreviewFolder, name);

		if (authority === 'none') {
			return resource;
		}

		return resource
			.with({ scheme: USER_DATA_SYNC_SCHEME, authority });
	}

	// /**
	//  * TODO: @lego
	//  */
	// private authorityMatches(
	// 	resource: URI,
	// 	authority: 'base' | 'local' | 'remote' | 'accepted' | 'none',
	// ): boolean {
	// 	let syncPreviewFolder = this.syncPreviewFolder;
	// 	if (authority !== 'none') {
	// 		syncPreviewFolder = syncPreviewFolder
	// 			.with({ scheme: USER_DATA_SYNC_SCHEME, authority });
	// 	}

	// 	return this.extUri.isEqualOrParent(
	// 		resource,
	// 		syncPreviewFolder,
	// 	);
	// }
}
