/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPromptsService } from './types.js';
import { URI } from '../../../../../../base/common/uri.js';
import { PromptsFileLocator } from '../promptFilesLocator.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import { dirname } from '../../../../../../base/common/resources.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IUserDataProfileService } from '../../../../../services/userDataProfile/common/userDataProfile.js';

/**
 * Provides prompt services.
 */
export class PromptsService extends Disposable implements IPromptsService {
	declare readonly _serviceBrand: undefined;

	/**
	 * Prompt files locator utility.
	 */
	private readonly fileLocator = this.initService.createInstance(PromptsFileLocator);

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IInstantiationService private readonly initService: IInstantiationService,
		@IUserDataProfileService private readonly userDataService: IUserDataProfileService,
	) {
		super();
	}

	public get globalPromptsLocation(): URI {
		return this.userDataService.currentProfile.promptsHome;
	}

	public async listLocalPrompts(): Promise<readonly URI[]> {
		const files = await this.fileLocator.listFiles([]);

		return files;
	}

	public async listGlobalPrompts(): Promise<readonly URI[]> {
		const files = await this.fileLocator.listFilesIn(
			[this.userDataService.currentProfile.promptsHome],
		);

		return files;
	}

	public async listAllPrompts(): Promise<readonly URI[]> {
		const prompts = await Promise.all([
			this.listGlobalPrompts(),
			this.listLocalPrompts(),
		]);

		return prompts.flat();
	}

	public async createPrompt(
		promptUri: URI,
		content: string,
	): Promise<this> {
		// TODO: @legomushroom - validate the prompt name

		// if a folder or file with the same name exists, throw an error
		if (await this.fileService.exists(promptUri)) {
			const promptInfo = await this.fileService.resolve(promptUri);

			if (promptInfo.isDirectory) {
				throw new Error('Directory with the same name already exists.');
			}

			throw new Error(`Prompt file '${promptUri.fsPath}' already exists.`);
		}

		// ensure the parent folder of the prompt file exists
		await this.fileService.createFolder(dirname(promptUri));

		// create the prompt file
		await this.fileService.createFile(promptUri, VSBuffer.fromString(content));

		return this;
	}

	// TODO: @legomushroom - remove
	// /**
	//  * Creates folder for `global` prompts if it does not exist.
	//  */
	// private async createGlobalPromptsFolder(): Promise<this> {
	// 	const globalPromptsLocation = this.userDataService.currentProfile.promptsHome;

	// 	if (await this.fileService.exists(globalPromptsLocation)) {
	// 		return this;
	// 	}

	// 	await this.fileService.createFolder(globalPromptsLocation);

	// 	return this;
	// }
}
