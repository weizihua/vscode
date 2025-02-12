/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../../nls.js';
import { URI } from '../../../../../../base/common/uri.js';
import { CHAT_CATEGORY } from '../../actions/chatActions.js';
import { KeyMod, KeyCode } from '../../../../../../base/common/keyCodes.js';
import { IPromptsService } from '../../../common/promptSyntax/service/types.js';
import { PROMPT_FILE_EXTENSION } from '../../../common/promptSyntax/constants.js';
import { IOpenerService } from '../../../../../../platform/opener/common/opener.js';
import { appendToCommandPalette } from '../../../../files/browser/fileActions.contribution.js';
import { IQuickInputService } from '../../../../../../platform/quickinput/common/quickInput.js';
import { ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../../../platform/keybinding/common/keybindingsRegistry.js';

/**
 * Keybinding of the command.
 */
const COMMAND_KEY_BINDING = KeyMod.Alt | KeyMod.Shift | KeyCode.KeyE;

/**
 * ID of the command.
 */
const COMMAND_ID = 'create-prompt';

/**
 * TODO: @legomushroom
 */
const getPromptName = async (
	quickInputService: IQuickInputService,
): Promise<string | undefined> => {
	const result = await quickInputService.input(
		{
			placeHolder: localize(
				'commands.prompts.create-prompt.name-placeholder',
				'Provide prompt name',
			),
		});

	if (!result) {
		return undefined;
	}

	const trimmedName = result.trim();
	if (!trimmedName) {
		// TODO: @legomushroom - show warning message?
		return undefined;
	}

	// TODO: @legomushroom - handle other file extensions too
	const cleanName = (trimmedName.endsWith(PROMPT_FILE_EXTENSION))
		? trimmedName
		: `${trimmedName}${PROMPT_FILE_EXTENSION}`;

	return cleanName;
};

/**
 * TODO: @legomushroom
 */
const createPromptCommand = async (
	accessor: ServicesAccessor,
): Promise<void> => {
	// TODO: @legomushroom - receive location instead
	let promptLocation: URI | undefined;

	const openerService = accessor.get(IOpenerService);
	const promptsService = accessor.get(IPromptsService);
	const quickInputService = accessor.get(IQuickInputService);

	if (!promptLocation) {
		promptLocation = promptsService.globalPromptsLocation;
	}

	// receive prompt name from the user
	const promptName = await getPromptName(quickInputService);
	if (!promptName) {
		return;
	}

	const promptUri = URI.joinPath(promptLocation, promptName);
	await promptsService.createPrompt(promptUri, 'Add prompt contents..'); // TODO: @legomushroom - get real initial content

	await openerService.open(promptUri);
};

/**
 * Register the "Create Prompt" command with its keybinding.
 */
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: COMMAND_ID,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: COMMAND_KEY_BINDING,
	handler: createPromptCommand,
});

/**
 * Register the "Create Prompt" command in the `command palette`.
 */
appendToCommandPalette(
	{
		id: COMMAND_ID,
		title: localize('commands.prompts.create-prompt', "Create Prompt"),
		category: CHAT_CATEGORY,
	},
);
