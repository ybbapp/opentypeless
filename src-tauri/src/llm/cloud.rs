#![allow(dead_code)]
use async_trait::async_trait;
use reqwest::Client;

use super::{prompt, ChunkCallback, LlmConfig, LlmProvider, PolishRequest, PolishResponse};
use crate::error::AppError;

/// Cloud LLM provider that proxies requests through the talkmore-web API.
/// Auth token is passed via the api_key field in LlmConfig. Quota is enforced server-side.
pub struct CloudLlmProvider {
    client: Client,
}

impl Default for CloudLlmProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl CloudLlmProvider {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    pub fn with_client(client: Client) -> Self {
        Self { client }
    }
}

fn contains_quota_marker(value: &str) -> bool {
    let value = value.to_ascii_lowercase();
    value.contains("quota")
        || value.contains("limit exceeded")
        || value.contains("usage exceeded")
        || value.contains("byok")
}

fn forbidden_error_message(value: &serde_json::Value) -> Option<String> {
    value
        .get("error")
        .and_then(|v| v.as_str())
        .or_else(|| value.get("message").and_then(|v| v.as_str()))
        .or_else(|| {
            value
                .get("error")
                .and_then(|v| v.get("message"))
                .and_then(|v| v.as_str())
        })
        .map(String::from)
}

fn quota_message_from_value(value: &serde_json::Value) -> Option<String> {
    for field in ["code", "error_code", "type"] {
        if value
            .get(field)
            .and_then(|v| v.as_str())
            .is_some_and(contains_quota_marker)
        {
            return Some(
                forbidden_error_message(value)
                    .unwrap_or_else(|| "Cloud LLM quota exceeded".to_string()),
            );
        }
    }

    for field in ["error", "message"] {
        if let Some(item) = value.get(field) {
            if let Some(message) = item.as_str() {
                if contains_quota_marker(message) {
                    return Some(message.to_string());
                }
            } else if let Some(message) = quota_message_from_value(item) {
                return Some(message);
            }
        }
    }

    None
}

fn cloud_llm_forbidden_error(body: &str) -> AppError {
    let parsed = serde_json::from_str::<serde_json::Value>(body).ok();

    if let Some(value) = parsed.as_ref() {
        if let Some(message) = quota_message_from_value(value) {
            return AppError::LlmQuota(message);
        }
    }

    AppError::Auth("Cloud LLM access denied".to_string())
}

fn cloud_context_metadata(
    context: &crate::app_detector::types::ContextProfileSummary,
) -> serde_json::Value {
    serde_json::json!({
        "profileId": context.profile_id,
        "family": context.family,
        "overrideId": context.override_id,
        "promptVersion": prompt::CONTEXT_PROMPT_VERSION,
    })
}

fn cloud_voice_intent_metadata(intent: &crate::voice_intent::VoiceIntent) -> serde_json::Value {
    serde_json::to_value(crate::voice_intent::VoiceIntentMetadata::from(intent))
        .expect("voice intent metadata must serialize")
}

#[async_trait]
impl LlmProvider for CloudLlmProvider {
    async fn polish(
        &self,
        _config: &LlmConfig,
        _req: &PolishRequest,
        _on_chunk: Option<&ChunkCallback>,
    ) -> Result<PolishResponse, AppError> {
        Err(AppError::Config(
            crate::official_managed_cloud_removed_error(),
        ))
    }

    fn name(&self) -> &str {
        "Cloud"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_detector::types::{ContextFamily, ContextProfileSummary};

    #[test]
    fn forbidden_error_uses_llm_quota_code() {
        let err = cloud_llm_forbidden_error(
            r#"{"code":"llm_quota_exceeded","error":"LLM quota exceeded"}"#,
        );
        assert!(matches!(err, AppError::LlmQuota(_)));
    }

    #[test]
    fn forbidden_error_uses_nested_llm_quota_message() {
        let err = cloud_llm_forbidden_error(
            r#"{"error":{"code":"llm_quota_exceeded","message":"LLM quota exceeded"}}"#,
        );
        assert!(matches!(err, AppError::LlmQuota(_)));
    }

    #[test]
    fn managed_context_metadata_excludes_labels_icons_and_raw_signals() {
        let metadata = cloud_context_metadata(&ContextProfileSummary {
            profile_id: "email.gmail".to_string(),
            family: ContextFamily::Email,
            app_label: "Gmail private label".to_string(),
            icon_key: "gmail".to_string(),
            override_id: Some("gmail".to_string()),
            browser_access_status: crate::app_detector::types::BrowserAccessStatus::NotApplicable,
            browser_target: None,
        });

        assert_eq!(metadata["profileId"], "email.gmail");
        assert_eq!(metadata["family"], "email");
        assert_eq!(metadata["promptVersion"], prompt::CONTEXT_PROMPT_VERSION);
        let serialized = metadata.to_string();
        for forbidden in [
            "private label",
            "iconKey",
            "processName",
            "windowTitle",
            "browserHost",
            "transcript",
        ] {
            assert!(!serialized.contains(forbidden));
        }
    }

    #[test]
    fn managed_voice_intent_metadata_excludes_payload_and_uses_closed_bands() {
        let intent = crate::voice_intent::VoiceIntent::from_parts(
            crate::voice_intent::VoiceIntentKind::DraftInsert,
            crate::voice_intent::VoiceOutputPlacement::InsertAtCursor,
            1.0,
            None,
            Some("private draft payload".to_string()),
            Some(crate::voice_intent::CommandLocale::En),
            None,
        )
        .unwrap();
        let metadata = cloud_voice_intent_metadata(&intent);

        assert_eq!(
            metadata,
            serde_json::json!({
                "kind": "draft_insert",
                "placement": "insert_at_cursor",
                "grammarLocale": "en",
                "confidenceBand": "exact"
            })
        );
        assert!(!metadata.to_string().contains("private draft payload"));
    }
}
