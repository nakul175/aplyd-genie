-- Staging only: apply after reviewed migrations008–009 and action-time approval.
BEGIN;
GRANT EXECUTE ON FUNCTION genie_switch_workspace(text,text,uuid,text),genie_sign_out_family(text),
 genie_create_conversation(text,text,text),genie_append_conversation(text,uuid,text),
 genie_list_conversations(text,uuid),genie_get_conversation(text,uuid,integer),genie_search_workspace(text,text) TO genie_runtime;
COMMIT;
