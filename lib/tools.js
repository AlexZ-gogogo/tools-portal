'use strict';

const tools = Object.freeze([
  { id: 'ai-image', name: 'AI Image Studio', category: 'ai', badge: 'AI', icon: 'paint-brush', tag: '图像生成', url: 'https://imageai-studio.azurewebsites.net/', description: 'AI 智能生图平台，支持文字生成图片、图片编辑等功能' },
  { id: 'quota-query', name: '订阅配额查询', category: 'azure', badge: 'Azure', icon: 'layer-group', tag: '配额查询', url: 'https://csp-ticket-tool-pc.azurewebsites.net/', description: '查询 Azure 订阅配额层级，快速了解资源配额信息' },
  { id: 'poe-flow', name: 'POE 工具', category: 'tool', badge: '效率', icon: 'robot', tag: '自动化', url: 'https://poeflowauto.azurewebsites.net/', description: 'POE 自动化流程工具，提升工作效率' },
  { id: 'aoai-deploy', name: 'AOAI 批量部署', category: 'azure', badge: 'Azure', icon: 'rocket', tag: '部署工具', url: 'https://aoai-deploy-tool.azurewebsites.net/', description: 'Azure OpenAI 模型批量部署工具，一键部署多区域模型' },
  { id: 'content-filter', name: '内容筛选器管理', category: 'azure', badge: 'Azure', icon: 'shield-alt', tag: '内容筛选', url: 'https://content-filter-manager.azurewebsites.net/', description: 'Azure OpenAI 内容筛选器批量管理工具，高效管理内容安全策略' },
  { id: 'new-api', name: 'New API 网关', category: 'ai', badge: 'AI', icon: 'network-wired', tag: 'API 网关', url: 'https://newapi-lingyu.azurewebsites.net/', description: '统一大模型接口网关，多模型统一接入与管理平台' },
  { id: 'batch-content', name: '批量取消内容审查', category: 'azure', badge: 'Azure', icon: 'clipboard-check', tag: '内容审查', url: 'https://batch-content-apply.azurewebsites.net/', description: '批量提交 Azure 订阅 ID，一键申请取消内容审查' },
]);

function getTool(id) { return tools.find(tool => tool.id === id); }
module.exports = { tools, getTool };
