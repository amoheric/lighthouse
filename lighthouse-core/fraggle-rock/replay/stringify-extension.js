/**
 * @license Copyright 2022 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

import {PuppeteerStringifyExtension} from '@puppeteer/replay';

/**
 * @param {import('@puppeteer/replay').Schema.Step} step
 * @return {boolean}
 */
function isNavigationStep(step) {
  return Boolean(
    step.type === 'navigate' ||
    step.assertedEvents?.some(event => event.type === 'navigation')
  );
}

class LighthouseStringifyExtension extends PuppeteerStringifyExtension {
  #isProcessingTimespan = false;

  /**
   * @param {Parameters<PuppeteerStringifyExtension['beforeAllSteps']>} args
   */
  async beforeAllSteps(...args) {
    const [out, flow] = args;
    out.appendLine(`const fs = require('fs');`);

    let isMobile = true;
    for (const step of flow.steps) {
      if (step.type !== 'setViewport') continue;
      isMobile = step.isMobile;
    }

    await super.beforeAllSteps(...args);

    const configContext = {
      settingsOverrides: {
        screenEmulation: {
          disabled: true,
        },
      },
    };
    out.appendLine(`const configContext = ${JSON.stringify(configContext)}`);
    if (isMobile) {
      out.appendLine(`const config = undefined;`);
    } else {
      // eslint-disable-next-line max-len
      out.appendLine(`const config = (await import('lighthouse/lighthouse-core/config/desktop-config.js')).default;`);
    }

    out.appendLine(`const lhApi = await import('lighthouse/lighthouse-core/fraggle-rock/api.js');`);
    // eslint-disable-next-line max-len
    out.appendLine(`const lhFlow = await lhApi.startFlow(page, {name: ${JSON.stringify(flow.title)}, config, configContext});`);
  }

  /**
   * @param {Parameters<PuppeteerStringifyExtension['stringifyStep']>} args
   */
  async stringifyStep(...args) {
    const [out, step] = args;

    if (step.type === 'setViewport') {
      await super.stringifyStep(...args);
      return;
    }

    const isNavigation = isNavigationStep(step);

    if (isNavigation) {
      if (this.#isProcessingTimespan) {
        out.appendLine(`await lhFlow.endTimespan();`);
        this.#isProcessingTimespan = false;
      }
      out.appendLine(`await lhFlow.startNavigation();`);
    } else if (!this.#isProcessingTimespan) {
      out.appendLine(`await lhFlow.startTimespan();`);
      this.#isProcessingTimespan = true;
    }

    await super.stringifyStep(...args);

    if (isNavigation) {
      out.appendLine(`await lhFlow.endNavigation();`);
    }
  }

  /**
   * @param {Parameters<PuppeteerStringifyExtension['afterAllSteps']>} args
   */
  async afterAllSteps(...args) {
    const [out] = args;
    if (this.#isProcessingTimespan) {
      out.appendLine(`await lhFlow.endTimespan();`);
    }
    out.appendLine(`const lhFlowReport = await lhFlow.generateReport();`);
    out.appendLine(`fs.writeFileSync(__dirname + '/flow.report.html', lhFlowReport)`);
    await super.afterAllSteps(...args);
  }
}

export default LighthouseStringifyExtension;
