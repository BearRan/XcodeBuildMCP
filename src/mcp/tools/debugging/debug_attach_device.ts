import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
import { createErrorResponse } from '../../../utils/responses/index.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { createTypedToolWithContext } from '../../../utils/typed-tool-factory.ts';
import {
  getDefaultDebuggerToolContext,
  type DebuggerToolContext,
} from '../../../utils/debugger/index.ts';

const baseSchemaObject = z.object({
  deviceId: z
    .string()
    .describe('UDID of the device (obtained from list_devices or session defaults)'),
  pid: z.number().int().positive().describe('Process ID of the app on device'),
  waitFor: z.boolean().optional().describe('Wait for the process to appear when attaching'),
  continueOnAttach: z.boolean().optional().default(true).describe('default: true'),
  makeCurrent: z
    .boolean()
    .optional()
    .default(true)
    .describe('Set debug session as current (default: true)'),
});

const debugAttachDeviceSchema = z.preprocess(
  nullifyEmptyStrings,
  baseSchemaObject.refine((val) => val.deviceId !== undefined && val.pid !== undefined, {
    message: 'deviceId and pid are required.',
  }),
);

export type DebugAttachDeviceParams = z.infer<typeof debugAttachDeviceSchema>;

export async function debug_attach_deviceLogic(
  params: DebugAttachDeviceParams,
  ctx: DebuggerToolContext,
): Promise<ToolResponse> {
  const { debugger: debuggerManager } = ctx;

  try {
    const session = await debuggerManager.createSession({
      // Reuse simulatorId field to track the physical device UDID for now.
      simulatorId: params.deviceId,
      pid: params.pid,
      waitFor: params.waitFor,
    });

    const isCurrent = params.makeCurrent ?? true;
    if (isCurrent) {
      debuggerManager.setCurrentSession(session.id);
    }

    const shouldContinue = params.continueOnAttach ?? true;
    if (shouldContinue) {
      try {
        await debuggerManager.resumeSession(session.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        try {
          await debuggerManager.detachSession(session.id);
        } catch (detachError) {
          const detachMessage =
            detachError instanceof Error ? detachError.message : String(detachError);
          log(
            'warn',
            `Failed to detach debugger session after resume failure (device): ${detachMessage}`,
          );
        }
        return createErrorResponse('Failed to resume debugger after attach', message);
      }
    }

    const currentText = isCurrent
      ? 'This session is now the current debug session.'
      : 'This session is not set as the current session.';
    const resumeText = shouldContinue
      ? 'Execution resumed after attach.'
      : 'Execution is paused. Use debug_continue to resume before UI automation.';

    const backendLabel = session.backend === 'dap' ? 'DAP debugger' : 'LLDB';

    return {
      content: [
        {
          type: 'text',
          text:
            `✅ Attached ${backendLabel} to device process ${params.pid} (${params.deviceId}).\n\n` +
            `Debug session ID: ${session.id}\n` +
            `${currentText}\n` +
            `${resumeText}`,
        },
      ],
      nextStepParams: {
        debug_breakpoint_add: { debugSessionId: session.id, file: '...', line: 123 },
        debug_continue: { debugSessionId: session.id },
        debug_stack: { debugSessionId: session.id },
      },
      isError: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Failed to attach debugger to device: ${message}`);
    return createErrorResponse('Failed to attach debugger', message);
  }
}

export const schema = baseSchemaObject.shape;

export const handler = createTypedToolWithContext<DebugAttachDeviceParams, DebuggerToolContext>(
  debugAttachDeviceSchema as unknown as z.ZodType<DebugAttachDeviceParams, unknown>,
  debug_attach_deviceLogic,
  getDefaultDebuggerToolContext,
);
