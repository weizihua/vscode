/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISyncData } from '../../userDataSync.js';
import { IStringDictionary } from '../../../../../base/common/collections.js';

/**
 * TODO: @legomushroom
 */
export const parsePrompts = (syncData: ISyncData): IStringDictionary<string> => {
	return JSON.parse(syncData.content);
};
