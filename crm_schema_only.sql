--
-- PostgreSQL database dump
--

\restrict XDWtDLbcrK3HJTZKXwGnz595Cw27W2KEFrK1Kj4UbNI2fvTfaTWJvVJz87caBbe

-- Dumped from database version 17.10 (Debian 17.10-1.pgdg13+1)
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: prevent_events_log_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_events_log_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'events_log entries are immutable and cannot be updated or deleted';
END;
$$;


--
-- Name: set_row_organization_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_row_organization_id() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW."Organization_ID" IS NULL THEN
    NEW."Organization_ID" := NULLIF(current_setting('app.current_organization_id', true), '')::uuid;
  END IF;
  IF NEW."Organization_ID" IS NULL THEN
    RAISE EXCEPTION 'organization context is required';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: update_modified_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_modified_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW."Updated_At" = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_tenants_view_row(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_tenants_view_row() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE organizations
  SET
    "Billing_Status" = COALESCE(NEW."Billing_Status", "Billing_Status"),
    "Purchased_Seats" = COALESCE(NEW."Purchased_Seats", "Purchased_Seats"),
    "Plan_Interval" = COALESCE(NEW."Plan_Interval", "Plan_Interval"),
    "Currency" = COALESCE(NEW."Currency", "Currency"),
    "Period_Ends_At" = COALESCE(NEW."Period_Ends_At", "Period_Ends_At"),
    "Trial_Ends_At" = COALESCE(NEW."Trial_Ends_At", "Trial_Ends_At"),
    "Paddle_Customer_ID" = COALESCE(NEW."Paddle_Customer_ID", "Paddle_Customer_ID"),
    "Paddle_Subscription_ID" = COALESCE(NEW."Paddle_Subscription_ID", "Paddle_Subscription_ID"),
    "Billing_Email" = COALESCE(NEW."Billing_Email", "Billing_Email")
  WHERE "Organization_ID"::text = OLD."Tenant_ID"
     OR LOWER("Name") = LOWER(OLD."Organization_Name");
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account_deletion_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_deletion_requests (
    "Request_ID" text NOT NULL,
    "Email" text NOT NULL,
    "Name" text NOT NULL,
    "Reason" text,
    "Created_At" timestamp with time zone DEFAULT now() NOT NULL,
    "Status" text DEFAULT 'Pending'::text NOT NULL,
    "Organization_ID" uuid NOT NULL
);

ALTER TABLE ONLY public.account_deletion_requests FORCE ROW LEVEL SECURITY;


--
-- Name: activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activities (
    "Log_ID" text NOT NULL,
    "Parent_Object_Type" text NOT NULL,
    "Parent_Object_ID" text NOT NULL,
    "Activity_Type" text NOT NULL,
    "Summary" text NOT NULL,
    "Detailed_Description" text NOT NULL,
    "Attachment_URL" text,
    "Follow_Up_Date" date,
    "Log_Date" timestamp with time zone NOT NULL,
    "Logged_By_User_ID" text NOT NULL,
    "Created_At" timestamp with time zone DEFAULT now() NOT NULL,
    "Updated_At" timestamp with time zone DEFAULT now() NOT NULL,
    "Deal_Stage_At_Log" text,
    "Event_Date" date,
    "Event_Time" time without time zone,
    "Organization_ID" uuid NOT NULL
);

ALTER TABLE ONLY public.activities FORCE ROW LEVEL SECURITY;


--
-- Name: activity_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_attachments (
    "Attachment_ID" text NOT NULL,
    "Log_ID" text NOT NULL,
    "File_Name" text NOT NULL,
    "Mime_Type" text NOT NULL,
    "File_Size" integer NOT NULL,
    "Storage_Path" text NOT NULL,
    "Uploaded_By_User_ID" text NOT NULL,
    "Uploaded_At" text NOT NULL,
    "Organization_ID" uuid NOT NULL
);

ALTER TABLE ONLY public.activity_attachments FORCE ROW LEVEL SECURITY;


--
-- Name: auth_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_sessions (
    "Session_ID" uuid DEFAULT gen_random_uuid() NOT NULL,
    "User_ID" text NOT NULL,
    "Token_Hash" text NOT NULL,
    "Expires_At" timestamp with time zone NOT NULL,
    "Revoked_At" timestamp with time zone,
    "Created_At" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: billing_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_events (
    "Event_ID" text NOT NULL,
    "Event_Type" text NOT NULL,
    "Tenant_ID" text,
    "Organization_ID" uuid,
    "Payload" jsonb NOT NULL,
    "Received_At" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: comment_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comment_reactions (
    "Reaction_ID" text NOT NULL,
    "Comment_ID" text NOT NULL,
    "User_ID" text NOT NULL,
    "Emoji" text NOT NULL,
    "Organization_ID" uuid NOT NULL
);

ALTER TABLE ONLY public.comment_reactions FORCE ROW LEVEL SECURITY;


--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contacts (
    "Contact_ID" text NOT NULL,
    "First_Name" text NOT NULL,
    "Last_Name" text NOT NULL,
    "Email" text NOT NULL,
    "Phone_Primary" text NOT NULL,
    "Organization_Name" text NOT NULL,
    "Contact_Type" text NOT NULL,
    "Source" text NOT NULL,
    "Created_Date" date NOT NULL,
    "Owner_ID" text NOT NULL,
    "Avatar_Data_URL" text,
    "Org_Avatar_Data_URL" text,
    "Created_At" timestamp with time zone DEFAULT now() NOT NULL,
    "Updated_At" timestamp with time zone DEFAULT now() NOT NULL,
    "Organization_ID" uuid NOT NULL
);

ALTER TABLE ONLY public.contacts FORCE ROW LEVEL SECURITY;


--
-- Name: deal_alert_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deal_alert_rules (
    "Rule_ID" text NOT NULL,
    "Organization_Name" text NOT NULL,
    "Rule_Name" text NOT NULL,
    "Stage_Name" text NOT NULL,
    "Days_Threshold" integer NOT NULL,
    "Status_Filter" text,
    "Message" text,
    "Is_Active" boolean DEFAULT true NOT NULL,
    "Created_By" text,
    "Created_At" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "Updated_At" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "Created_By_User_ID" text,
    "Rule_Type" text DEFAULT 'stage_duration'::text,
    "Organization_ID" uuid NOT NULL,
    CONSTRAINT "deal_alert_rules_Days_Threshold_check" CHECK (("Days_Threshold" > 0))
);

ALTER TABLE ONLY public.deal_alert_rules FORCE ROW LEVEL SECURITY;


--
-- Name: deal_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deal_attachments (
    "Attachment_ID" text NOT NULL,
    "Deal_ID" text NOT NULL,
    "File_Name" text NOT NULL,
    "Mime_Type" text NOT NULL,
    "File_Size" bigint NOT NULL,
    "Storage_Path" text NOT NULL,
    "Media_Type" text DEFAULT 'voice'::text NOT NULL,
    "Uploaded_By_User_ID" text NOT NULL,
    "Uploaded_At" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "Organization_ID" uuid NOT NULL,
    CONSTRAINT "deal_attachments_Media_Type_check" CHECK (("Media_Type" = ANY (ARRAY['voice'::text, 'video'::text, 'audio'::text]))),
    CONSTRAINT deal_attachments_media_type_check CHECK (("Media_Type" = ANY (ARRAY['voice'::text, 'video'::text, 'audio'::text])))
);

ALTER TABLE ONLY public.deal_attachments FORCE ROW LEVEL SECURITY;


--
-- Name: deal_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deal_contacts (
    "Deal_ID" text NOT NULL,
    "Contact_ID" text NOT NULL,
    "Is_Primary" boolean DEFAULT false NOT NULL,
    "Organization_ID" uuid NOT NULL
);

ALTER TABLE ONLY public.deal_contacts FORCE ROW LEVEL SECURITY;


--
-- Name: deal_rag_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deal_rag_history (
    "Rag_History_ID" text NOT NULL,
    "Deal_ID" text NOT NULL,
    "Rag_Status" text NOT NULL,
    "Previous_Status" text,
    "Changed_By_User_ID" text NOT NULL,
    "Changed_By_Name" text,
    "Changed_At" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "Organization_ID" uuid NOT NULL,
    CONSTRAINT "deal_rag_history_Previous_Status_check" CHECK ((("Previous_Status" IS NULL) OR ("Previous_Status" = ANY (ARRAY['Red'::text, 'Amber'::text, 'Green'::text])))),
    CONSTRAINT "deal_rag_history_Rag_Status_check" CHECK (("Rag_Status" = ANY (ARRAY['Red'::text, 'Amber'::text, 'Green'::text])))
);

ALTER TABLE ONLY public.deal_rag_history FORCE ROW LEVEL SECURITY;


--
-- Name: deal_team_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deal_team_members (
    "Deal_ID" text NOT NULL,
    "User_ID" text NOT NULL,
    "Organization_ID" uuid NOT NULL
);

ALTER TABLE ONLY public.deal_team_members FORCE ROW LEVEL SECURITY;


--
-- Name: deal_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deal_types (
    "Type_ID" text NOT NULL,
    "Label" text NOT NULL,
    "Is_Active" boolean DEFAULT true NOT NULL,
    "Sort_Order" integer DEFAULT 0 NOT NULL,
    "Organization_ID" uuid NOT NULL
);

ALTER TABLE ONLY public.deal_types FORCE ROW LEVEL SECURITY;


--
-- Name: deals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deals (
    "Deal_ID" text NOT NULL,
    "Deal_Name" text NOT NULL,
    "Associated_Contact_ID" text NOT NULL,
    "Pipeline_ID" text NOT NULL,
    "Current_Stage" text NOT NULL,
    "Deal_Value" double precision NOT NULL,
    "Expected_Close_Date" date NOT NULL,
    "Probability_Percentage" integer NOT NULL,
    "Win_Loss_Reason" text,
    "Owner_ID" text NOT NULL,
    "Status" text NOT NULL,
    "Deal_Source" character varying(10),
    "Created_At" timestamp with time zone DEFAULT now() NOT NULL,
    "Updated_At" timestamp with time zone DEFAULT now() NOT NULL,
    "ARR" double precision DEFAULT 0 NOT NULL,
    "TCV" double precision DEFAULT 0 NOT NULL,
    "TLV" double precision DEFAULT 0 NOT NULL,
    "Commission" double precision DEFAULT 0 NOT NULL,
    "Partner_Commission" double precision DEFAULT 0 NOT NULL,
    "Distributor_Commission" double precision DEFAULT 0 NOT NULL,
    "Deal_Type" text,
    "Sale_Type" text,
    "Region_Name" text,
    "Territory_Name" text,
    "Region" text,
    "Is_Favorite" boolean DEFAULT false NOT NULL,
    "Rag_Status" text,
    "Organization_ID" uuid NOT NULL,
    CONSTRAINT deals_rag_status_check CHECK ((("Rag_Status" IS NULL) OR ("Rag_Status" = ANY (ARRAY['Red'::text, 'Amber'::text, 'Green'::text]))))
);

ALTER TABLE ONLY public.deals FORCE ROW LEVEL SECURITY;


--
-- Name: events_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events_log (
    "Log_Entry_ID" integer NOT NULL,
    "Timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    "User_ID" text NOT NULL,
    "User_Name" text NOT NULL,
    "Action_Type" text NOT NULL,
    "Object_Type" text NOT NULL,
    "Object_ID" text NOT NULL,
    "Object_Name" text NOT NULL,
    "Before_State" text,
    "After_State" text,
    "Organization_ID" uuid NOT NULL
);

ALTER TABLE ONLY public.events_log FORCE ROW LEVEL SECURITY;


--
-- Name: events_log_Log_Entry_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."events_log_Log_Entry_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: events_log_Log_Entry_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."events_log_Log_Entry_ID_seq" OWNED BY public.events_log."Log_Entry_ID";


--
-- Name: line_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.line_items (
    "Line_Item_ID" text NOT NULL,
    "Deal_ID" text NOT NULL,
    "Product_ID" text NOT NULL,
    "Quantity" integer NOT NULL,
    "Unit_Price_At_Sale" double precision NOT NULL,
    "Discount_Amount" double precision NOT NULL,
    "Total_Line_Value" double precision NOT NULL,
    "Organization_ID" uuid NOT NULL
);

ALTER TABLE ONLY public.line_items FORCE ROW LEVEL SECURITY;


--
-- Name: organization_feature_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_feature_overrides (
    "Override_ID" uuid DEFAULT gen_random_uuid() NOT NULL,
    "Organization_ID" uuid NOT NULL,
    "Feature_Key" text NOT NULL,
    "Value" jsonb NOT NULL,
    "Expires_At" timestamp with time zone,
    "Created_At" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.organization_feature_overrides FORCE ROW LEVEL SECURITY;


--
-- Name: organization_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_invitations (
    "Invitation_ID" uuid DEFAULT gen_random_uuid() NOT NULL,
    "Organization_ID" uuid NOT NULL,
    "Email" text NOT NULL,
    "Role" text DEFAULT 'Sales_Rep'::text NOT NULL,
    "Token_Hash" text NOT NULL,
    "Expires_At" timestamp with time zone NOT NULL,
    "Accepted_At" timestamp with time zone,
    "Created_By_User_ID" text NOT NULL,
    "Created_At" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.organization_invitations FORCE ROW LEVEL SECURITY;


--
-- Name: organization_regions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_regions (
    "Region_ID" uuid DEFAULT gen_random_uuid() NOT NULL,
    "Organization_ID" uuid NOT NULL,
    "Name" text NOT NULL,
    "Created_At" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: organization_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_subscriptions (
    "Subscription_ID" uuid DEFAULT gen_random_uuid() NOT NULL,
    "Organization_ID" uuid NOT NULL,
    "Plan_ID" uuid NOT NULL,
    "Status" text NOT NULL,
    "Trial_Ends_At" timestamp with time zone,
    "Current_Period_Ends_At" timestamp with time zone,
    "Cancel_At_Period_End" boolean DEFAULT false NOT NULL,
    "Provider" text,
    "Provider_Customer_ID" text,
    "Provider_Subscription_ID" text,
    "Entitlement_Snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "Created_At" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "Updated_At" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "organization_subscriptions_Status_check" CHECK (("Status" = ANY (ARRAY['trialing'::text, 'active'::text, 'past_due'::text, 'cancelled'::text, 'expired'::text])))
);

ALTER TABLE ONLY public.organization_subscriptions FORCE ROW LEVEL SECURITY;


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    "Organization_ID" uuid DEFAULT gen_random_uuid() NOT NULL,
    "Name" text NOT NULL,
    "Slug" text NOT NULL,
    "Status" text DEFAULT 'Active'::text NOT NULL,
    "Owner_User_ID" text,
    "Trial_Ends_At" timestamp with time zone DEFAULT (CURRENT_TIMESTAMP + '30 days'::interval),
    "Created_At" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "Updated_At" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "Period_Ends_At" timestamp with time zone,
    "Billing_Status" text DEFAULT 'trialing'::text NOT NULL,
    "Plan_Interval" text,
    "Currency" text,
    "Purchased_Seats" integer DEFAULT 3,
    "Paddle_Customer_ID" text,
    "Paddle_Subscription_ID" text,
    "Billing_Email" text,
    "Pending_Plan_Interval" text,
    "Pending_Upgrade_Seats" integer,
    CONSTRAINT "organizations_Status_check" CHECK (("Status" = ANY (ARRAY['Active'::text, 'Suspended'::text, 'Cancelled'::text])))
);

ALTER TABLE ONLY public.organizations FORCE ROW LEVEL SECURITY;


--
-- Name: pipelines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipelines (
    "Pipeline_ID" text NOT NULL,
    "Pipeline_Name" text NOT NULL,
    "Stages_JSON" jsonb NOT NULL,
    "Organization_ID" uuid NOT NULL
);

ALTER TABLE ONLY public.pipelines FORCE ROW LEVEL SECURITY;


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    "Product_ID" text NOT NULL,
    "Name" text NOT NULL,
    "SKU_Code" text NOT NULL,
    "Type" text NOT NULL,
    "Unit_Price" double precision NOT NULL,
    "Description" text NOT NULL,
    "Is_Active" boolean DEFAULT true NOT NULL,
    "Organization_ID" uuid NOT NULL
);

ALTER TABLE ONLY public.products FORCE ROW LEVEL SECURITY;


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    id integer NOT NULL,
    filename text NOT NULL,
    executed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: schema_migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.schema_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: schema_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.schema_migrations_id_seq OWNED BY public.schema_migrations.id;


--
-- Name: subscription_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_events (
    "Event_ID" uuid DEFAULT gen_random_uuid() NOT NULL,
    "Provider" text NOT NULL,
    "Provider_Event_ID" text NOT NULL,
    "Organization_ID" uuid,
    "Payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "Processed_At" timestamp with time zone,
    "Created_At" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.subscription_events FORCE ROW LEVEL SECURITY;


--
-- Name: subscription_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_plans (
    "Plan_ID" uuid DEFAULT gen_random_uuid() NOT NULL,
    "Plan_Code" text NOT NULL,
    "Name" text NOT NULL,
    "Is_Active" boolean DEFAULT true NOT NULL,
    "Feature_Limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "Provider_Product_ID" text,
    "Provider_Price_ID" text,
    "Created_At" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: task_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_attachments (
    "Attachment_ID" text NOT NULL,
    "Task_ID" text NOT NULL,
    "File_Name" text NOT NULL,
    "Mime_Type" text NOT NULL,
    "File_Size" integer NOT NULL,
    "Storage_Path" text NOT NULL,
    "Uploaded_By" text NOT NULL,
    "Uploaded_At" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "Organization_ID" uuid NOT NULL
);

ALTER TABLE ONLY public.task_attachments FORCE ROW LEVEL SECURITY;


--
-- Name: task_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_comments (
    "Comment_ID" text NOT NULL,
    "Task_ID" text NOT NULL,
    "User_ID" text NOT NULL,
    "User_Name" text DEFAULT ''::text NOT NULL,
    "Content" text DEFAULT ''::text NOT NULL,
    "Attachment_URL" text,
    "Created_At" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "Organization_ID" uuid NOT NULL
);

ALTER TABLE ONLY public.task_comments FORCE ROW LEVEL SECURITY;


--
-- Name: task_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_notifications (
    "Notification_ID" text NOT NULL,
    "User_ID" text NOT NULL,
    "Task_ID" text NOT NULL,
    "Message" text NOT NULL,
    "Is_Read" boolean DEFAULT false NOT NULL,
    "Created_At" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "Organization_ID" uuid NOT NULL
);

ALTER TABLE ONLY public.task_notifications FORCE ROW LEVEL SECURITY;


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    "Task_ID" text NOT NULL,
    "Task_Title" text NOT NULL,
    "Description" text,
    "Assigned_To" text NOT NULL,
    "Assigned_By" text NOT NULL,
    "Due_Date" date NOT NULL,
    "Status" text DEFAULT 'Open'::text NOT NULL,
    "Is_Read" boolean DEFAULT false NOT NULL,
    "Created_At" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "Organization_ID" uuid NOT NULL
);

ALTER TABLE ONLY public.tasks FORCE ROW LEVEL SECURITY;


--
-- Name: tenants; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.tenants AS
 SELECT ("Organization_ID")::text AS "Tenant_ID",
    "Name" AS "Organization_Name",
    "Created_At",
    "Trial_Ends_At",
    "Period_Ends_At",
    "Billing_Status",
    "Plan_Interval",
    "Currency",
    "Purchased_Seats",
    "Paddle_Customer_ID",
    "Paddle_Subscription_ID",
    "Billing_Email",
    "Pending_Plan_Interval",
    "Pending_Upgrade_Seats"
   FROM public.organizations;


--
-- Name: user_alert_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_alert_states (
    "State_ID" text NOT NULL,
    "User_ID" text NOT NULL,
    "Alert_Key" text NOT NULL,
    "Status" text DEFAULT 'dismissed'::text NOT NULL,
    "Snooze_Until" timestamp with time zone,
    "Updated_At" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "Dismissed_At" timestamp with time zone,
    "Organization_ID" uuid NOT NULL,
    CONSTRAINT "user_alert_states_Status_check" CHECK (("Status" = ANY (ARRAY['snoozed'::text, 'dismissed'::text, 'missed'::text]))),
    CONSTRAINT user_alert_states_status_check CHECK (("Status" = ANY (ARRAY['snoozed'::text, 'dismissed'::text, 'missed'::text])))
);

ALTER TABLE ONLY public.user_alert_states FORCE ROW LEVEL SECURITY;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    "User_ID" text NOT NULL,
    "First_Name" text NOT NULL,
    "Last_Name" text NOT NULL,
    "Email" text NOT NULL,
    "Role" text NOT NULL,
    "Status" text NOT NULL,
    "Password" text,
    "Avatar_Data_URL" text,
    "Avatar_Updated_At" text,
    "Phone_Number" text,
    "Organization_Name" text,
    "Residential_Address" text,
    "Office_Address" text,
    "Created_At" timestamp with time zone DEFAULT now() NOT NULL,
    "Updated_At" timestamp with time zone DEFAULT now() NOT NULL,
    "Region_Name" text,
    "Territory_Name" text,
    "Region" text,
    "Organization_ID" uuid NOT NULL,
    "Mobile_Number" text
);

ALTER TABLE ONLY public.users FORCE ROW LEVEL SECURITY;


--
-- Name: COLUMN users."Status"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users."Status" IS 'Active | Inactive | Pending_Approval';


--
-- Name: events_log Log_Entry_ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events_log ALTER COLUMN "Log_Entry_ID" SET DEFAULT nextval('public."events_log_Log_Entry_ID_seq"'::regclass);


--
-- Name: schema_migrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations ALTER COLUMN id SET DEFAULT nextval('public.schema_migrations_id_seq'::regclass);


--
-- Name: account_deletion_requests account_deletion_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_deletion_requests
    ADD CONSTRAINT account_deletion_requests_pkey PRIMARY KEY ("Request_ID");


--
-- Name: activities activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_pkey PRIMARY KEY ("Log_ID");


--
-- Name: activity_attachments activity_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_attachments
    ADD CONSTRAINT activity_attachments_pkey PRIMARY KEY ("Attachment_ID");


--
-- Name: auth_sessions auth_sessions_Token_Hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT "auth_sessions_Token_Hash_key" UNIQUE ("Token_Hash");


--
-- Name: auth_sessions auth_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_pkey PRIMARY KEY ("Session_ID");


--
-- Name: billing_events billing_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_events
    ADD CONSTRAINT billing_events_pkey PRIMARY KEY ("Event_ID");


--
-- Name: comment_reactions comment_reactions_Comment_ID_User_ID_Emoji_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_reactions
    ADD CONSTRAINT "comment_reactions_Comment_ID_User_ID_Emoji_key" UNIQUE ("Comment_ID", "User_ID", "Emoji");


--
-- Name: comment_reactions comment_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_reactions
    ADD CONSTRAINT comment_reactions_pkey PRIMARY KEY ("Reaction_ID");


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY ("Contact_ID");


--
-- Name: deal_alert_rules deal_alert_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_alert_rules
    ADD CONSTRAINT deal_alert_rules_pkey PRIMARY KEY ("Rule_ID");


--
-- Name: deal_attachments deal_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_attachments
    ADD CONSTRAINT deal_attachments_pkey PRIMARY KEY ("Attachment_ID");


--
-- Name: deal_contacts deal_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_contacts
    ADD CONSTRAINT deal_contacts_pkey PRIMARY KEY ("Deal_ID", "Contact_ID");


--
-- Name: deal_rag_history deal_rag_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_rag_history
    ADD CONSTRAINT deal_rag_history_pkey PRIMARY KEY ("Rag_History_ID");


--
-- Name: deal_team_members deal_team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_team_members
    ADD CONSTRAINT deal_team_members_pkey PRIMARY KEY ("Deal_ID", "User_ID");


--
-- Name: deal_types deal_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_types
    ADD CONSTRAINT deal_types_pkey PRIMARY KEY ("Type_ID");


--
-- Name: deals deals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_pkey PRIMARY KEY ("Deal_ID");


--
-- Name: events_log events_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events_log
    ADD CONSTRAINT events_log_pkey PRIMARY KEY ("Log_Entry_ID");


--
-- Name: line_items line_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_items
    ADD CONSTRAINT line_items_pkey PRIMARY KEY ("Line_Item_ID");


--
-- Name: organization_feature_overrides organization_feature_overrides_Organization_ID_Feature_Key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_feature_overrides
    ADD CONSTRAINT "organization_feature_overrides_Organization_ID_Feature_Key_key" UNIQUE ("Organization_ID", "Feature_Key");


--
-- Name: organization_feature_overrides organization_feature_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_feature_overrides
    ADD CONSTRAINT organization_feature_overrides_pkey PRIMARY KEY ("Override_ID");


--
-- Name: organization_invitations organization_invitations_Organization_ID_Email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_invitations
    ADD CONSTRAINT "organization_invitations_Organization_ID_Email_key" UNIQUE ("Organization_ID", "Email");


--
-- Name: organization_invitations organization_invitations_Token_Hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_invitations
    ADD CONSTRAINT "organization_invitations_Token_Hash_key" UNIQUE ("Token_Hash");


--
-- Name: organization_invitations organization_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_invitations
    ADD CONSTRAINT organization_invitations_pkey PRIMARY KEY ("Invitation_ID");


--
-- Name: organization_regions organization_regions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_regions
    ADD CONSTRAINT organization_regions_pkey PRIMARY KEY ("Region_ID");


--
-- Name: organization_subscriptions organization_subscriptions_Organization_ID_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_subscriptions
    ADD CONSTRAINT "organization_subscriptions_Organization_ID_key" UNIQUE ("Organization_ID");


--
-- Name: organization_subscriptions organization_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_subscriptions
    ADD CONSTRAINT organization_subscriptions_pkey PRIMARY KEY ("Subscription_ID");


--
-- Name: organizations organizations_Slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT "organizations_Slug_key" UNIQUE ("Slug");


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY ("Organization_ID");


--
-- Name: pipelines pipelines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipelines
    ADD CONSTRAINT pipelines_pkey PRIMARY KEY ("Pipeline_ID");


--
-- Name: products products_SKU_Code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT "products_SKU_Code_key" UNIQUE ("SKU_Code");


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY ("Product_ID");


--
-- Name: schema_migrations schema_migrations_filename_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_filename_key UNIQUE (filename);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (id);


--
-- Name: subscription_events subscription_events_Provider_Provider_Event_ID_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_events
    ADD CONSTRAINT "subscription_events_Provider_Provider_Event_ID_key" UNIQUE ("Provider", "Provider_Event_ID");


--
-- Name: subscription_events subscription_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_events
    ADD CONSTRAINT subscription_events_pkey PRIMARY KEY ("Event_ID");


--
-- Name: subscription_plans subscription_plans_Plan_Code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_plans
    ADD CONSTRAINT "subscription_plans_Plan_Code_key" UNIQUE ("Plan_Code");


--
-- Name: subscription_plans subscription_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_plans
    ADD CONSTRAINT subscription_plans_pkey PRIMARY KEY ("Plan_ID");


--
-- Name: task_attachments task_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_attachments
    ADD CONSTRAINT task_attachments_pkey PRIMARY KEY ("Attachment_ID");


--
-- Name: task_comments task_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_pkey PRIMARY KEY ("Comment_ID");


--
-- Name: task_notifications task_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_notifications
    ADD CONSTRAINT task_notifications_pkey PRIMARY KEY ("Notification_ID");


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY ("Task_ID");


--
-- Name: organization_regions uq_org_region_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_regions
    ADD CONSTRAINT uq_org_region_name UNIQUE ("Organization_ID", "Name");


--
-- Name: user_alert_states user_alert_states_User_ID_Alert_Key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_alert_states
    ADD CONSTRAINT "user_alert_states_User_ID_Alert_Key_key" UNIQUE ("User_ID", "Alert_Key");


--
-- Name: user_alert_states user_alert_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_alert_states
    ADD CONSTRAINT user_alert_states_pkey PRIMARY KEY ("State_ID");


--
-- Name: users users_Email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "users_Email_key" UNIQUE ("Email");


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY ("User_ID");


--
-- Name: auth_sessions_user_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_sessions_user_active_idx ON public.auth_sessions USING btree ("User_ID", "Expires_At") WHERE ("Revoked_At" IS NULL);


--
-- Name: idx_account_deletion_requests_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_deletion_requests_organization ON public.account_deletion_requests USING btree ("Organization_ID");


--
-- Name: idx_activities_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_organization ON public.activities USING btree ("Organization_ID");


--
-- Name: idx_activity_attachments_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_attachments_organization ON public.activity_attachments USING btree ("Organization_ID");


--
-- Name: idx_att_log; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_att_log ON public.activity_attachments USING btree ("Log_ID");


--
-- Name: idx_billing_events_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_billing_events_org ON public.billing_events USING btree ("Organization_ID", "Received_At" DESC);


--
-- Name: idx_billing_events_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_billing_events_tenant ON public.billing_events USING btree ("Tenant_ID", "Received_At" DESC);


--
-- Name: idx_comment_reactions_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comment_reactions_organization ON public.comment_reactions USING btree ("Organization_ID");


--
-- Name: idx_contacts_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_organization ON public.contacts USING btree ("Organization_ID");


--
-- Name: idx_deal_alert_rules_active_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_alert_rules_active_stage ON public.deal_alert_rules USING btree ("Organization_Name", "Stage_Name") WHERE ("Is_Active" = true);


--
-- Name: idx_deal_alert_rules_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_alert_rules_org ON public.deal_alert_rules USING btree ("Organization_Name");


--
-- Name: idx_deal_alert_rules_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_alert_rules_organization ON public.deal_alert_rules USING btree ("Organization_ID");


--
-- Name: idx_deal_attachments_deal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_attachments_deal ON public.deal_attachments USING btree ("Deal_ID", "Uploaded_At" DESC);


--
-- Name: idx_deal_attachments_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_attachments_organization ON public.deal_attachments USING btree ("Organization_ID");


--
-- Name: idx_deal_attachments_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_attachments_type ON public.deal_attachments USING btree ("Deal_ID", "Media_Type");


--
-- Name: idx_deal_contacts_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_contacts_organization ON public.deal_contacts USING btree ("Organization_ID");


--
-- Name: idx_deal_rag_history_deal_changed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_rag_history_deal_changed ON public.deal_rag_history USING btree ("Deal_ID", "Changed_At" DESC);


--
-- Name: idx_deal_rag_history_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_rag_history_organization ON public.deal_rag_history USING btree ("Organization_ID");


--
-- Name: idx_deal_team_members_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_team_members_organization ON public.deal_team_members USING btree ("Organization_ID");


--
-- Name: idx_deal_types_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_types_organization ON public.deal_types USING btree ("Organization_ID");


--
-- Name: idx_deals_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_created_at ON public.deals USING btree ("Created_At");


--
-- Name: idx_deals_deal_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_deal_type ON public.deals USING btree ("Deal_Type");


--
-- Name: idx_deals_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_organization ON public.deals USING btree ("Organization_ID");


--
-- Name: idx_deals_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_region ON public.deals USING btree ("Region_Name");


--
-- Name: idx_deals_sale_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_sale_type ON public.deals USING btree ("Sale_Type");


--
-- Name: idx_deals_territory; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_territory ON public.deals USING btree ("Territory_Name");


--
-- Name: idx_events_log_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_log_organization ON public.events_log USING btree ("Organization_ID");


--
-- Name: idx_events_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_timestamp ON public.events_log USING btree ("Timestamp" DESC);


--
-- Name: idx_line_items_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_line_items_organization ON public.line_items USING btree ("Organization_ID");


--
-- Name: idx_org_regions_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_regions_org_id ON public.organization_regions USING btree ("Organization_ID");


--
-- Name: idx_organizations_billing_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_organizations_billing_status ON public.organizations USING btree ("Billing_Status");


--
-- Name: idx_organizations_paddle_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_organizations_paddle_sub ON public.organizations USING btree ("Paddle_Subscription_ID");


--
-- Name: idx_pipelines_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pipelines_organization ON public.pipelines USING btree ("Organization_ID");


--
-- Name: idx_products_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_organization ON public.products USING btree ("Organization_ID");


--
-- Name: idx_task_attachments_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_attachments_organization ON public.task_attachments USING btree ("Organization_ID");


--
-- Name: idx_task_comments_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_comments_organization ON public.task_comments USING btree ("Organization_ID");


--
-- Name: idx_task_notifications_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_notifications_organization ON public.task_notifications USING btree ("Organization_ID");


--
-- Name: idx_tasks_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_organization ON public.tasks USING btree ("Organization_ID");


--
-- Name: idx_user_alert_states_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_alert_states_organization ON public.user_alert_states USING btree ("Organization_ID");


--
-- Name: idx_user_alert_states_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_alert_states_user ON public.user_alert_states USING btree ("User_ID");


--
-- Name: idx_users_org_mobile; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_users_org_mobile ON public.users USING btree ("Organization_ID", "Mobile_Number") WHERE (("Mobile_Number" IS NOT NULL) AND ("Mobile_Number" <> ''::text));


--
-- Name: idx_users_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_organization ON public.users USING btree ("Organization_ID");


--
-- Name: organization_invitations_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_invitations_lookup_idx ON public.organization_invitations USING btree ("Organization_ID", lower("Email"));


--
-- Name: pipelines_organization_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pipelines_organization_name_unique ON public.pipelines USING btree ("Organization_ID", "Pipeline_Name");


--
-- Name: products_organization_sku_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX products_organization_sku_unique ON public.products USING btree ("Organization_ID", "SKU_Code");


--
-- Name: subscription_events_organization_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscription_events_organization_idx ON public.subscription_events USING btree ("Organization_ID");


--
-- Name: users_email_lower_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_lower_uidx ON public.users USING btree (lower("Email"));


--
-- Name: users_organization_email_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_organization_email_unique ON public.users USING btree ("Organization_ID", lower("Email"));


--
-- Name: events_log events_log_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER events_log_no_delete BEFORE DELETE ON public.events_log FOR EACH ROW EXECUTE FUNCTION public.prevent_events_log_mutation();


--
-- Name: events_log events_log_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER events_log_no_update BEFORE UPDATE ON public.events_log FOR EACH ROW EXECUTE FUNCTION public.prevent_events_log_mutation();


--
-- Name: account_deletion_requests set_organization_id_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_organization_id_before_write BEFORE INSERT OR UPDATE ON public.account_deletion_requests FOR EACH ROW EXECUTE FUNCTION public.set_row_organization_id();


--
-- Name: activities set_organization_id_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_organization_id_before_write BEFORE INSERT OR UPDATE ON public.activities FOR EACH ROW EXECUTE FUNCTION public.set_row_organization_id();


--
-- Name: activity_attachments set_organization_id_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_organization_id_before_write BEFORE INSERT OR UPDATE ON public.activity_attachments FOR EACH ROW EXECUTE FUNCTION public.set_row_organization_id();


--
-- Name: comment_reactions set_organization_id_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_organization_id_before_write BEFORE INSERT OR UPDATE ON public.comment_reactions FOR EACH ROW EXECUTE FUNCTION public.set_row_organization_id();


--
-- Name: contacts set_organization_id_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_organization_id_before_write BEFORE INSERT OR UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.set_row_organization_id();


--
-- Name: deal_alert_rules set_organization_id_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_organization_id_before_write BEFORE INSERT OR UPDATE ON public.deal_alert_rules FOR EACH ROW EXECUTE FUNCTION public.set_row_organization_id();


--
-- Name: deal_attachments set_organization_id_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_organization_id_before_write BEFORE INSERT OR UPDATE ON public.deal_attachments FOR EACH ROW EXECUTE FUNCTION public.set_row_organization_id();


--
-- Name: deal_contacts set_organization_id_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_organization_id_before_write BEFORE INSERT OR UPDATE ON public.deal_contacts FOR EACH ROW EXECUTE FUNCTION public.set_row_organization_id();


--
-- Name: deal_rag_history set_organization_id_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_organization_id_before_write BEFORE INSERT OR UPDATE ON public.deal_rag_history FOR EACH ROW EXECUTE FUNCTION public.set_row_organization_id();


--
-- Name: deal_team_members set_organization_id_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_organization_id_before_write BEFORE INSERT OR UPDATE ON public.deal_team_members FOR EACH ROW EXECUTE FUNCTION public.set_row_organization_id();


--
-- Name: deal_types set_organization_id_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_organization_id_before_write BEFORE INSERT OR UPDATE ON public.deal_types FOR EACH ROW EXECUTE FUNCTION public.set_row_organization_id();


--
-- Name: deals set_organization_id_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_organization_id_before_write BEFORE INSERT OR UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.set_row_organization_id();


--
-- Name: events_log set_organization_id_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_organization_id_before_write BEFORE INSERT OR UPDATE ON public.events_log FOR EACH ROW EXECUTE FUNCTION public.set_row_organization_id();


--
-- Name: line_items set_organization_id_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_organization_id_before_write BEFORE INSERT OR UPDATE ON public.line_items FOR EACH ROW EXECUTE FUNCTION public.set_row_organization_id();


--
-- Name: organization_feature_overrides set_organization_id_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_organization_id_before_write BEFORE INSERT OR UPDATE ON public.organization_feature_overrides FOR EACH ROW EXECUTE FUNCTION public.set_row_organization_id();


--
-- Name: organization_invitations set_organization_id_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_organization_id_before_write BEFORE INSERT OR UPDATE ON public.organization_invitations FOR EACH ROW EXECUTE FUNCTION public.set_row_organization_id();


--
-- Name: organization_subscriptions set_organization_id_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_organization_id_before_write BEFORE INSERT OR UPDATE ON public.organization_subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_row_organization_id();


--
-- Name: pipelines set_organization_id_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_organization_id_before_write BEFORE INSERT OR UPDATE ON public.pipelines FOR EACH ROW EXECUTE FUNCTION public.set_row_organization_id();


--
-- Name: products set_organization_id_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_organization_id_before_write BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_row_organization_id();


--
-- Name: subscription_events set_organization_id_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_organization_id_before_write BEFORE INSERT OR UPDATE ON public.subscription_events FOR EACH ROW EXECUTE FUNCTION public.set_row_organization_id();


--
-- Name: task_attachments set_organization_id_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_organization_id_before_write BEFORE INSERT OR UPDATE ON public.task_attachments FOR EACH ROW EXECUTE FUNCTION public.set_row_organization_id();


--
-- Name: task_comments set_organization_id_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_organization_id_before_write BEFORE INSERT OR UPDATE ON public.task_comments FOR EACH ROW EXECUTE FUNCTION public.set_row_organization_id();


--
-- Name: task_notifications set_organization_id_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_organization_id_before_write BEFORE INSERT OR UPDATE ON public.task_notifications FOR EACH ROW EXECUTE FUNCTION public.set_row_organization_id();


--
-- Name: tasks set_organization_id_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_organization_id_before_write BEFORE INSERT OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.set_row_organization_id();


--
-- Name: user_alert_states set_organization_id_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_organization_id_before_write BEFORE INSERT OR UPDATE ON public.user_alert_states FOR EACH ROW EXECUTE FUNCTION public.set_row_organization_id();


--
-- Name: users set_organization_id_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_organization_id_before_write BEFORE INSERT OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_row_organization_id();


--
-- Name: tenants trg_update_tenants_view; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_update_tenants_view INSTEAD OF UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.update_tenants_view_row();


--
-- Name: activities update_activities_modtime; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_activities_modtime BEFORE UPDATE ON public.activities FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();


--
-- Name: contacts update_contacts_modtime; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_contacts_modtime BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();


--
-- Name: deal_alert_rules update_deal_alert_rules_modtime; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_deal_alert_rules_modtime BEFORE UPDATE ON public.deal_alert_rules FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();


--
-- Name: deals update_deals_modtime; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_deals_modtime BEFORE UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();


--
-- Name: users update_users_modtime; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_users_modtime BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();


--
-- Name: activities activities_Logged_By_User_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT "activities_Logged_By_User_ID_fkey" FOREIGN KEY ("Logged_By_User_ID") REFERENCES public.users("User_ID") ON DELETE RESTRICT;


--
-- Name: activity_attachments activity_attachments_Log_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_attachments
    ADD CONSTRAINT "activity_attachments_Log_ID_fkey" FOREIGN KEY ("Log_ID") REFERENCES public.activities("Log_ID") ON DELETE CASCADE;


--
-- Name: auth_sessions auth_sessions_User_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT "auth_sessions_User_ID_fkey" FOREIGN KEY ("User_ID") REFERENCES public.users("User_ID") ON DELETE CASCADE;


--
-- Name: billing_events billing_events_Organization_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_events
    ADD CONSTRAINT "billing_events_Organization_ID_fkey" FOREIGN KEY ("Organization_ID") REFERENCES public.organizations("Organization_ID") ON DELETE SET NULL;


--
-- Name: comment_reactions comment_reactions_Comment_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_reactions
    ADD CONSTRAINT "comment_reactions_Comment_ID_fkey" FOREIGN KEY ("Comment_ID") REFERENCES public.task_comments("Comment_ID") ON DELETE CASCADE;


--
-- Name: comment_reactions comment_reactions_User_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_reactions
    ADD CONSTRAINT "comment_reactions_User_ID_fkey" FOREIGN KEY ("User_ID") REFERENCES public.users("User_ID") ON DELETE CASCADE;


--
-- Name: contacts contacts_Owner_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT "contacts_Owner_ID_fkey" FOREIGN KEY ("Owner_ID") REFERENCES public.users("User_ID") ON DELETE RESTRICT;


--
-- Name: deal_alert_rules deal_alert_rules_Created_By_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_alert_rules
    ADD CONSTRAINT "deal_alert_rules_Created_By_fkey" FOREIGN KEY ("Created_By") REFERENCES public.users("User_ID") ON DELETE SET NULL;


--
-- Name: deal_attachments deal_attachments_Deal_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_attachments
    ADD CONSTRAINT "deal_attachments_Deal_ID_fkey" FOREIGN KEY ("Deal_ID") REFERENCES public.deals("Deal_ID") ON DELETE CASCADE;


--
-- Name: deal_attachments deal_attachments_Uploaded_By_User_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_attachments
    ADD CONSTRAINT "deal_attachments_Uploaded_By_User_ID_fkey" FOREIGN KEY ("Uploaded_By_User_ID") REFERENCES public.users("User_ID") ON DELETE CASCADE;


--
-- Name: deal_contacts deal_contacts_Contact_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_contacts
    ADD CONSTRAINT "deal_contacts_Contact_ID_fkey" FOREIGN KEY ("Contact_ID") REFERENCES public.contacts("Contact_ID") ON DELETE CASCADE;


--
-- Name: deal_contacts deal_contacts_Deal_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_contacts
    ADD CONSTRAINT "deal_contacts_Deal_ID_fkey" FOREIGN KEY ("Deal_ID") REFERENCES public.deals("Deal_ID") ON DELETE CASCADE;


--
-- Name: deal_rag_history deal_rag_history_Deal_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_rag_history
    ADD CONSTRAINT "deal_rag_history_Deal_ID_fkey" FOREIGN KEY ("Deal_ID") REFERENCES public.deals("Deal_ID") ON DELETE CASCADE;


--
-- Name: deal_team_members deal_team_members_Deal_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_team_members
    ADD CONSTRAINT "deal_team_members_Deal_ID_fkey" FOREIGN KEY ("Deal_ID") REFERENCES public.deals("Deal_ID") ON DELETE CASCADE;


--
-- Name: deal_team_members deal_team_members_User_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_team_members
    ADD CONSTRAINT "deal_team_members_User_ID_fkey" FOREIGN KEY ("User_ID") REFERENCES public.users("User_ID") ON DELETE CASCADE;


--
-- Name: deals deals_Associated_Contact_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT "deals_Associated_Contact_ID_fkey" FOREIGN KEY ("Associated_Contact_ID") REFERENCES public.contacts("Contact_ID") ON DELETE RESTRICT;


--
-- Name: deals deals_Owner_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT "deals_Owner_ID_fkey" FOREIGN KEY ("Owner_ID") REFERENCES public.users("User_ID") ON DELETE RESTRICT;


--
-- Name: deals deals_Pipeline_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT "deals_Pipeline_ID_fkey" FOREIGN KEY ("Pipeline_ID") REFERENCES public.pipelines("Pipeline_ID") ON DELETE RESTRICT;


--
-- Name: line_items line_items_Deal_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_items
    ADD CONSTRAINT "line_items_Deal_ID_fkey" FOREIGN KEY ("Deal_ID") REFERENCES public.deals("Deal_ID") ON DELETE CASCADE;


--
-- Name: line_items line_items_Product_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_items
    ADD CONSTRAINT "line_items_Product_ID_fkey" FOREIGN KEY ("Product_ID") REFERENCES public.products("Product_ID") ON DELETE RESTRICT;


--
-- Name: organization_feature_overrides organization_feature_overrides_Organization_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_feature_overrides
    ADD CONSTRAINT "organization_feature_overrides_Organization_ID_fkey" FOREIGN KEY ("Organization_ID") REFERENCES public.organizations("Organization_ID") ON DELETE CASCADE;


--
-- Name: organization_invitations organization_invitations_Created_By_User_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_invitations
    ADD CONSTRAINT "organization_invitations_Created_By_User_ID_fkey" FOREIGN KEY ("Created_By_User_ID") REFERENCES public.users("User_ID") ON DELETE CASCADE;


--
-- Name: organization_invitations organization_invitations_Organization_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_invitations
    ADD CONSTRAINT "organization_invitations_Organization_ID_fkey" FOREIGN KEY ("Organization_ID") REFERENCES public.organizations("Organization_ID") ON DELETE CASCADE;


--
-- Name: organization_regions organization_regions_Organization_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_regions
    ADD CONSTRAINT "organization_regions_Organization_ID_fkey" FOREIGN KEY ("Organization_ID") REFERENCES public.organizations("Organization_ID") ON DELETE CASCADE;


--
-- Name: organization_subscriptions organization_subscriptions_Organization_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_subscriptions
    ADD CONSTRAINT "organization_subscriptions_Organization_ID_fkey" FOREIGN KEY ("Organization_ID") REFERENCES public.organizations("Organization_ID") ON DELETE CASCADE;


--
-- Name: organization_subscriptions organization_subscriptions_Plan_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_subscriptions
    ADD CONSTRAINT "organization_subscriptions_Plan_ID_fkey" FOREIGN KEY ("Plan_ID") REFERENCES public.subscription_plans("Plan_ID");


--
-- Name: organizations organizations_owner_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_owner_user_fk FOREIGN KEY ("Owner_User_ID") REFERENCES public.users("User_ID") ON DELETE SET NULL;


--
-- Name: subscription_events subscription_events_Organization_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_events
    ADD CONSTRAINT "subscription_events_Organization_ID_fkey" FOREIGN KEY ("Organization_ID") REFERENCES public.organizations("Organization_ID") ON DELETE SET NULL;


--
-- Name: task_attachments task_attachments_Task_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_attachments
    ADD CONSTRAINT "task_attachments_Task_ID_fkey" FOREIGN KEY ("Task_ID") REFERENCES public.tasks("Task_ID") ON DELETE CASCADE;


--
-- Name: task_attachments task_attachments_Uploaded_By_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_attachments
    ADD CONSTRAINT "task_attachments_Uploaded_By_fkey" FOREIGN KEY ("Uploaded_By") REFERENCES public.users("User_ID") ON DELETE CASCADE;


--
-- Name: task_comments task_comments_Task_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT "task_comments_Task_ID_fkey" FOREIGN KEY ("Task_ID") REFERENCES public.tasks("Task_ID") ON DELETE CASCADE;


--
-- Name: task_comments task_comments_User_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT "task_comments_User_ID_fkey" FOREIGN KEY ("User_ID") REFERENCES public.users("User_ID") ON DELETE CASCADE;


--
-- Name: task_notifications task_notifications_Task_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_notifications
    ADD CONSTRAINT "task_notifications_Task_ID_fkey" FOREIGN KEY ("Task_ID") REFERENCES public.tasks("Task_ID") ON DELETE CASCADE;


--
-- Name: task_notifications task_notifications_User_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_notifications
    ADD CONSTRAINT "task_notifications_User_ID_fkey" FOREIGN KEY ("User_ID") REFERENCES public.users("User_ID") ON DELETE CASCADE;


--
-- Name: tasks tasks_Assigned_By_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT "tasks_Assigned_By_fkey" FOREIGN KEY ("Assigned_By") REFERENCES public.users("User_ID") ON DELETE CASCADE;


--
-- Name: tasks tasks_Assigned_To_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT "tasks_Assigned_To_fkey" FOREIGN KEY ("Assigned_To") REFERENCES public.users("User_ID") ON DELETE CASCADE;


--
-- Name: user_alert_states user_alert_states_User_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_alert_states
    ADD CONSTRAINT "user_alert_states_User_ID_fkey" FOREIGN KEY ("User_ID") REFERENCES public.users("User_ID") ON DELETE CASCADE;


--
-- Name: users users_organization_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_organization_fk FOREIGN KEY ("Organization_ID") REFERENCES public.organizations("Organization_ID") ON DELETE RESTRICT;


--
-- Name: account_deletion_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: activities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

--
-- Name: activities activities_rls_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY activities_rls_policy ON public.activities USING (((current_setting('app.bypass_rls'::text, true) = 'true'::text) OR (EXISTS ( SELECT 1
   FROM public.users logger
  WHERE ((logger."User_ID" = activities."Logged_By_User_ID") AND (logger."Organization_Name" = current_setting('app.current_user_tenant'::text, true)) AND ((current_setting('app.current_user_role'::text, true) = ANY (ARRAY['Sales_Admin'::text, 'Admin'::text, 'Executive'::text])) OR (activities."Logged_By_User_ID" = current_setting('app.current_user_id'::text, true)) OR ((activities."Parent_Object_Type" = 'Deal'::text) AND (EXISTS ( SELECT 1
           FROM public.deals d
          WHERE ((d."Deal_ID" = activities."Parent_Object_ID") AND (d."Owner_ID" = current_setting('app.current_user_id'::text, true)))))) OR ((activities."Parent_Object_Type" = 'Contact'::text) AND (EXISTS ( SELECT 1
           FROM public.contacts c
          WHERE ((c."Contact_ID" = activities."Parent_Object_ID") AND (c."Owner_ID" = current_setting('app.current_user_id'::text, true)))))))))))) WITH CHECK (((current_setting('app.bypass_rls'::text, true) = 'true'::text) OR (EXISTS ( SELECT 1
   FROM public.users logger
  WHERE ((logger."User_ID" = activities."Logged_By_User_ID") AND (logger."Organization_Name" = current_setting('app.current_user_tenant'::text, true)) AND ((current_setting('app.current_user_role'::text, true) = ANY (ARRAY['Sales_Admin'::text, 'Admin'::text, 'Executive'::text])) OR (activities."Logged_By_User_ID" = current_setting('app.current_user_id'::text, true)) OR ((activities."Parent_Object_Type" = 'Deal'::text) AND (EXISTS ( SELECT 1
           FROM public.deals d
          WHERE ((d."Deal_ID" = activities."Parent_Object_ID") AND (d."Owner_ID" = current_setting('app.current_user_id'::text, true)))))) OR ((activities."Parent_Object_Type" = 'Contact'::text) AND (EXISTS ( SELECT 1
           FROM public.contacts c
          WHERE ((c."Contact_ID" = activities."Parent_Object_ID") AND (c."Owner_ID" = current_setting('app.current_user_id'::text, true))))))))))));


--
-- Name: activity_attachments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activity_attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: activity_attachments activity_attachments_rls_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY activity_attachments_rls_policy ON public.activity_attachments USING (((current_setting('app.bypass_rls'::text, true) = 'true'::text) OR (EXISTS ( SELECT 1
   FROM (public.activities a
     JOIN public.users logger ON ((logger."User_ID" = a."Logged_By_User_ID")))
  WHERE ((a."Log_ID" = activity_attachments."Log_ID") AND (logger."Organization_Name" = current_setting('app.current_user_tenant'::text, true)) AND ((current_setting('app.current_user_role'::text, true) = ANY (ARRAY['Sales_Admin'::text, 'Admin'::text, 'Executive'::text])) OR (a."Logged_By_User_ID" = current_setting('app.current_user_id'::text, true)) OR ((a."Parent_Object_Type" = 'Deal'::text) AND (EXISTS ( SELECT 1
           FROM public.deals d
          WHERE ((d."Deal_ID" = a."Parent_Object_ID") AND (d."Owner_ID" = current_setting('app.current_user_id'::text, true)))))) OR ((a."Parent_Object_Type" = 'Contact'::text) AND (EXISTS ( SELECT 1
           FROM public.contacts c
          WHERE ((c."Contact_ID" = a."Parent_Object_ID") AND (c."Owner_ID" = current_setting('app.current_user_id'::text, true)))))))))))) WITH CHECK (((current_setting('app.bypass_rls'::text, true) = 'true'::text) OR (EXISTS ( SELECT 1
   FROM (public.activities a
     JOIN public.users logger ON ((logger."User_ID" = a."Logged_By_User_ID")))
  WHERE ((a."Log_ID" = activity_attachments."Log_ID") AND (logger."Organization_Name" = current_setting('app.current_user_tenant'::text, true)) AND ((current_setting('app.current_user_role'::text, true) = ANY (ARRAY['Sales_Admin'::text, 'Admin'::text, 'Executive'::text])) OR (a."Logged_By_User_ID" = current_setting('app.current_user_id'::text, true)) OR ((a."Parent_Object_Type" = 'Deal'::text) AND (EXISTS ( SELECT 1
           FROM public.deals d
          WHERE ((d."Deal_ID" = a."Parent_Object_ID") AND (d."Owner_ID" = current_setting('app.current_user_id'::text, true)))))) OR ((a."Parent_Object_Type" = 'Contact'::text) AND (EXISTS ( SELECT 1
           FROM public.contacts c
          WHERE ((c."Contact_ID" = a."Parent_Object_ID") AND (c."Owner_ID" = current_setting('app.current_user_id'::text, true))))))))))));


--
-- Name: comment_reactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.comment_reactions ENABLE ROW LEVEL SECURITY;

--
-- Name: contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: contacts contacts_rls_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contacts_rls_policy ON public.contacts USING (((current_setting('app.bypass_rls'::text, true) = 'true'::text) OR (EXISTS ( SELECT 1
   FROM public.users owner_user
  WHERE ((owner_user."User_ID" = contacts."Owner_ID") AND (owner_user."Organization_Name" = current_setting('app.current_user_tenant'::text, true)) AND ((current_setting('app.current_user_role'::text, true) = ANY (ARRAY['Sales_Admin'::text, 'Admin'::text, 'Executive'::text])) OR (contacts."Owner_ID" = current_setting('app.current_user_id'::text, true)))))))) WITH CHECK (((current_setting('app.bypass_rls'::text, true) = 'true'::text) OR (EXISTS ( SELECT 1
   FROM public.users owner_user
  WHERE ((owner_user."User_ID" = contacts."Owner_ID") AND (owner_user."Organization_Name" = current_setting('app.current_user_tenant'::text, true)) AND ((current_setting('app.current_user_role'::text, true) = ANY (ARRAY['Sales_Admin'::text, 'Admin'::text, 'Executive'::text])) OR (contacts."Owner_ID" = current_setting('app.current_user_id'::text, true))))))));


--
-- Name: deal_alert_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deal_alert_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: deal_attachments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deal_attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: deal_attachments deal_attachments_rls_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deal_attachments_rls_policy ON public.deal_attachments USING (((current_setting('app.bypass_rls'::text, true) = 'true'::text) OR (EXISTS ( SELECT 1
   FROM (public.deals d
     JOIN public.users owner_user ON ((owner_user."User_ID" = d."Owner_ID")))
  WHERE ((d."Deal_ID" = deal_attachments."Deal_ID") AND (owner_user."Organization_Name" = current_setting('app.current_user_tenant'::text, true)) AND (((current_setting('app.current_user_role'::text, true) = ANY (ARRAY['Sales_Admin'::text, 'Admin'::text, 'Executive'::text])) AND ((current_setting('app.current_user_region'::text, true) IS NULL) OR (current_setting('app.current_user_region'::text, true) = ''::text) OR (d."Region" IS NULL) OR (d."Region" = ''::text) OR (d."Region" = ANY (regexp_split_to_array(current_setting('app.current_user_region'::text, true), '\s*,\s*'::text))))) OR (d."Owner_ID" = current_setting('app.current_user_id'::text, true)) OR (EXISTS ( SELECT 1
           FROM public.deal_team_members dtm
          WHERE ((dtm."Deal_ID" = d."Deal_ID") AND (dtm."User_ID" = current_setting('app.current_user_id'::text, true))))))))))) WITH CHECK (((current_setting('app.bypass_rls'::text, true) = 'true'::text) OR (EXISTS ( SELECT 1
   FROM (public.deals d
     JOIN public.users owner_user ON ((owner_user."User_ID" = d."Owner_ID")))
  WHERE ((d."Deal_ID" = deal_attachments."Deal_ID") AND (owner_user."Organization_Name" = current_setting('app.current_user_tenant'::text, true)) AND ((current_setting('app.current_user_role'::text, true) = ANY (ARRAY['Sales_Admin'::text, 'Admin'::text])) OR (d."Owner_ID" = current_setting('app.current_user_id'::text, true)) OR (EXISTS ( SELECT 1
           FROM public.deal_team_members dtm
          WHERE ((dtm."Deal_ID" = d."Deal_ID") AND (dtm."User_ID" = current_setting('app.current_user_id'::text, true)))))))))));


--
-- Name: deal_contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deal_contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: deal_contacts deal_contacts_rls_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deal_contacts_rls_policy ON public.deal_contacts USING (((current_setting('app.bypass_rls'::text, true) = 'true'::text) OR (EXISTS ( SELECT 1
   FROM (public.deals d
     JOIN public.users owner_user ON ((owner_user."User_ID" = d."Owner_ID")))
  WHERE ((d."Deal_ID" = deal_contacts."Deal_ID") AND (owner_user."Organization_Name" = current_setting('app.current_user_tenant'::text, true)) AND (((current_setting('app.current_user_role'::text, true) = ANY (ARRAY['Sales_Admin'::text, 'Admin'::text, 'Executive'::text])) AND ((current_setting('app.current_user_region'::text, true) IS NULL) OR (current_setting('app.current_user_region'::text, true) = ''::text) OR (d."Region" = ANY (regexp_split_to_array(current_setting('app.current_user_region'::text, true), '\s*,\s*'::text))))) OR (d."Owner_ID" = current_setting('app.current_user_id'::text, true)) OR (EXISTS ( SELECT 1
           FROM public.deal_team_members dtm
          WHERE ((dtm."Deal_ID" = d."Deal_ID") AND (dtm."User_ID" = current_setting('app.current_user_id'::text, true))))))))))) WITH CHECK (((current_setting('app.bypass_rls'::text, true) = 'true'::text) OR (EXISTS ( SELECT 1
   FROM (public.deals d
     JOIN public.users owner_user ON ((owner_user."User_ID" = d."Owner_ID")))
  WHERE ((d."Deal_ID" = deal_contacts."Deal_ID") AND (owner_user."Organization_Name" = current_setting('app.current_user_tenant'::text, true)) AND (((current_setting('app.current_user_role'::text, true) = ANY (ARRAY['Sales_Admin'::text, 'Admin'::text, 'Executive'::text])) AND ((current_setting('app.current_user_region'::text, true) IS NULL) OR (current_setting('app.current_user_region'::text, true) = ''::text) OR (d."Region" = ANY (regexp_split_to_array(current_setting('app.current_user_region'::text, true), '\s*,\s*'::text))))) OR (d."Owner_ID" = current_setting('app.current_user_id'::text, true)) OR (EXISTS ( SELECT 1
           FROM public.deal_team_members dtm
          WHERE ((dtm."Deal_ID" = d."Deal_ID") AND (dtm."User_ID" = current_setting('app.current_user_id'::text, true)))))))))));


--
-- Name: deal_rag_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deal_rag_history ENABLE ROW LEVEL SECURITY;

--
-- Name: deal_team_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deal_team_members ENABLE ROW LEVEL SECURITY;

--
-- Name: deal_team_members deal_team_members_rls_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deal_team_members_rls_policy ON public.deal_team_members USING (((current_setting('app.bypass_rls'::text, true) = 'true'::text) OR (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u."User_ID" = deal_team_members."User_ID") AND (u."Organization_Name" = current_setting('app.current_user_tenant'::text, true))))))) WITH CHECK (((current_setting('app.bypass_rls'::text, true) = 'true'::text) OR (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u."User_ID" = deal_team_members."User_ID") AND (u."Organization_Name" = current_setting('app.current_user_tenant'::text, true)))))));


--
-- Name: deal_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deal_types ENABLE ROW LEVEL SECURITY;

--
-- Name: deals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

--
-- Name: deals deals_rls_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deals_rls_policy ON public.deals USING (((current_setting('app.bypass_rls'::text, true) = 'true'::text) OR (EXISTS ( SELECT 1
   FROM public.users owner_user
  WHERE ((owner_user."User_ID" = deals."Owner_ID") AND (owner_user."Organization_Name" = current_setting('app.current_user_tenant'::text, true)) AND (((current_setting('app.current_user_role'::text, true) = ANY (ARRAY['Sales_Admin'::text, 'Admin'::text, 'Executive'::text])) AND ((current_setting('app.current_user_region'::text, true) IS NULL) OR (current_setting('app.current_user_region'::text, true) = ''::text) OR (deals."Region" = ANY (regexp_split_to_array(current_setting('app.current_user_region'::text, true), '\s*,\s*'::text))))) OR (deals."Owner_ID" = current_setting('app.current_user_id'::text, true)) OR (EXISTS ( SELECT 1
           FROM public.deal_team_members dtm
          WHERE ((dtm."Deal_ID" = deals."Deal_ID") AND (dtm."User_ID" = current_setting('app.current_user_id'::text, true))))))))))) WITH CHECK (((current_setting('app.bypass_rls'::text, true) = 'true'::text) OR (EXISTS ( SELECT 1
   FROM public.users owner_user
  WHERE ((owner_user."User_ID" = deals."Owner_ID") AND (owner_user."Organization_Name" = current_setting('app.current_user_tenant'::text, true)) AND (((current_setting('app.current_user_role'::text, true) = ANY (ARRAY['Sales_Admin'::text, 'Admin'::text, 'Executive'::text])) AND ((current_setting('app.current_user_region'::text, true) IS NULL) OR (current_setting('app.current_user_region'::text, true) = ''::text) OR (deals."Region" = ANY (regexp_split_to_array(current_setting('app.current_user_region'::text, true), '\s*,\s*'::text))))) OR (deals."Owner_ID" = current_setting('app.current_user_id'::text, true)) OR (EXISTS ( SELECT 1
           FROM public.deal_team_members dtm
          WHERE ((dtm."Deal_ID" = deals."Deal_ID") AND (dtm."User_ID" = current_setting('app.current_user_id'::text, true)))))))))));


--
-- Name: events_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.events_log ENABLE ROW LEVEL SECURITY;

--
-- Name: line_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.line_items ENABLE ROW LEVEL SECURITY;

--
-- Name: line_items line_items_rls_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY line_items_rls_policy ON public.line_items USING (((current_setting('app.bypass_rls'::text, true) = 'true'::text) OR (EXISTS ( SELECT 1
   FROM (public.deals d
     JOIN public.users owner_user ON ((owner_user."User_ID" = d."Owner_ID")))
  WHERE ((d."Deal_ID" = line_items."Deal_ID") AND (owner_user."Organization_Name" = current_setting('app.current_user_tenant'::text, true)) AND (((current_setting('app.current_user_role'::text, true) = ANY (ARRAY['Sales_Admin'::text, 'Admin'::text, 'Executive'::text])) AND ((current_setting('app.current_user_region'::text, true) IS NULL) OR (current_setting('app.current_user_region'::text, true) = ''::text) OR (d."Region" = ANY (regexp_split_to_array(current_setting('app.current_user_region'::text, true), '\s*,\s*'::text))))) OR (d."Owner_ID" = current_setting('app.current_user_id'::text, true)) OR (EXISTS ( SELECT 1
           FROM public.deal_team_members dtm
          WHERE ((dtm."Deal_ID" = d."Deal_ID") AND (dtm."User_ID" = current_setting('app.current_user_id'::text, true))))))))))) WITH CHECK (((current_setting('app.bypass_rls'::text, true) = 'true'::text) OR (EXISTS ( SELECT 1
   FROM (public.deals d
     JOIN public.users owner_user ON ((owner_user."User_ID" = d."Owner_ID")))
  WHERE ((d."Deal_ID" = line_items."Deal_ID") AND (owner_user."Organization_Name" = current_setting('app.current_user_tenant'::text, true)) AND (((current_setting('app.current_user_role'::text, true) = ANY (ARRAY['Sales_Admin'::text, 'Admin'::text, 'Executive'::text])) AND ((current_setting('app.current_user_region'::text, true) IS NULL) OR (current_setting('app.current_user_region'::text, true) = ''::text) OR (d."Region" = ANY (regexp_split_to_array(current_setting('app.current_user_region'::text, true), '\s*,\s*'::text))))) OR (d."Owner_ID" = current_setting('app.current_user_id'::text, true)) OR (EXISTS ( SELECT 1
           FROM public.deal_team_members dtm
          WHERE ((dtm."Deal_ID" = d."Deal_ID") AND (dtm."User_ID" = current_setting('app.current_user_id'::text, true)))))))))));


--
-- Name: organization_feature_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_feature_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_invitations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_regions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_regions ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_regions organization_regions_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organization_regions_tenant_policy ON public.organization_regions USING (((current_setting('app.bypass_rls'::text, true) = 'true'::text) OR (current_setting('app.current_organization_id'::text, true) IS NULL) OR (current_setting('app.current_organization_id'::text, true) = ''::text) OR ("Organization_ID" = (current_setting('app.current_organization_id'::text, true))::uuid))) WITH CHECK (((current_setting('app.bypass_rls'::text, true) = 'true'::text) OR (current_setting('app.current_organization_id'::text, true) IS NULL) OR (current_setting('app.current_organization_id'::text, true) = ''::text) OR ("Organization_ID" = (current_setting('app.current_organization_id'::text, true))::uuid)));


--
-- Name: organization_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: pipelines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;

--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: subscription_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;

--
-- Name: task_attachments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: task_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: task_notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: account_deletion_requests tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.account_deletion_requests USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: activities tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.activities USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: activity_attachments tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.activity_attachments USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: comment_reactions tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.comment_reactions USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: contacts tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.contacts USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: deal_alert_rules tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.deal_alert_rules USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: deal_attachments tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.deal_attachments USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: deal_contacts tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.deal_contacts USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: deal_rag_history tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.deal_rag_history USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: deal_team_members tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.deal_team_members USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: deal_types tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.deal_types USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: deals tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.deals USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: events_log tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.events_log USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: line_items tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.line_items USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: organization_feature_overrides tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.organization_feature_overrides USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: organization_invitations tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.organization_invitations USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: organization_subscriptions tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.organization_subscriptions USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: organizations tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.organizations USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: pipelines tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.pipelines USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: products tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.products USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: subscription_events tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.subscription_events USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: task_attachments tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.task_attachments USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: task_comments tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.task_comments USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: task_notifications tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.task_notifications USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: tasks tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.tasks USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: user_alert_states tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.user_alert_states USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: users tenant_isolation_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_policy ON public.users USING (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)) WITH CHECK (("Organization_ID" = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid));


--
-- Name: user_alert_states; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_alert_states ENABLE ROW LEVEL SECURITY;

--
-- Name: user_alert_states user_alert_states_rls_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_alert_states_rls_policy ON public.user_alert_states USING (((current_setting('app.bypass_rls'::text, true) = 'true'::text) OR ("User_ID" = current_setting('app.current_user_id'::text, true)) OR (current_setting('app.current_user_role'::text, true) = ANY (ARRAY['Sales_Admin'::text, 'Admin'::text, 'Executive'::text])))) WITH CHECK (((current_setting('app.bypass_rls'::text, true) = 'true'::text) OR ("User_ID" = current_setting('app.current_user_id'::text, true))));


--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict XDWtDLbcrK3HJTZKXwGnz595Cw27W2KEFrK1Kj4UbNI2fvTfaTWJvVJz87caBbe

