import { isWebMCPSupported, WEBMCP_TOOL_NAMES } from '../webmcp/registerTools';

export default function WebMCPBadge() {
  const supported = isWebMCPSupported();
  return (
    <div
      className={`webmcp-badge ${supported ? 'webmcp-badge--active' : 'webmcp-badge--unsupported'}`}
      title={
        supported
          ? `WebMCP is active. ${WEBMCP_TOOL_NAMES.length} tools registered for AI agents to call.`
          : 'WebMCP not detected in this browser. Tools are NOT registered. Use Chrome with the WebMCP flag or a compatible agentic browser to enable.'
      }
    >
      <span className="webmcp-badge-dot" aria-hidden="true" />
      <span className="webmcp-badge-label">
        WebMCP: {supported ? `Active (${WEBMCP_TOOL_NAMES.length} tools)` : 'Not supported'}
      </span>
    </div>
  );
}
