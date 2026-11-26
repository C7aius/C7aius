export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: { Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json }; Returns: Json };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      attendance: {
        Row: {
          course_id: string;
          marked_at: string;
          marked_by: string | null;
          present: boolean;
          profile_id: string;
        };
        ComputedFields: never;
        Insert: {
          course_id: string;
          marked_at?: string;
          marked_by?: string | null;
          present: boolean;
          profile_id: string;
        };
        Update: {
          course_id?: string;
          marked_at?: string;
          marked_by?: string | null;
          present?: boolean;
          profile_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "attendance_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "course_booking_counts";
            referencedColumns: ["course_id"];
          },
          {
            foreignKeyName: "attendance_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_marked_by_fkey";
            columns: ["marked_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_marked_by_fkey";
            columns: ["marked_by"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      bookings: {
        Row: {
          booked_by: string | null;
          cancelled_at: string | null;
          course_id: string;
          created_at: string;
          free_trial: boolean;
          id: string;
          payment_status: string;
          pending_until: string | null;
          price: number;
          profile_id: string;
        };
        ComputedFields: never;
        Insert: {
          booked_by?: string | null;
          cancelled_at?: string | null;
          course_id: string;
          created_at?: string;
          free_trial?: boolean;
          id?: string;
          payment_status?: string;
          pending_until?: string | null;
          price?: number;
          profile_id: string;
        };
        Update: {
          booked_by?: string | null;
          cancelled_at?: string | null;
          course_id?: string;
          created_at?: string;
          free_trial?: boolean;
          id?: string;
          payment_status?: string;
          pending_until?: string | null;
          price?: number;
          profile_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bookings_booked_by_fkey";
            columns: ["booked_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_booked_by_fkey";
            columns: ["booked_by"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "course_booking_counts";
            referencedColumns: ["course_id"];
          },
          {
            foreignKeyName: "bookings_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      course_series: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "course_series_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "course_series_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      courses: {
        Row: {
          created_at: string;
          created_by: string | null;
          ends_at: string;
          id: string;
          is_private: boolean;
          kind: Database["public"]["Enums"]["course_kind"];
          level: Database["public"]["Enums"]["course_level"];
          location_id: string;
          places: number;
          price_member: number;
          price_non_member: number;
          prof_id: string | null;
          series_id: string | null;
          sport: Database["public"]["Enums"]["sport"];
          starts_at: string;
          status: Database["public"]["Enums"]["course_status"];
          vacancy_notified_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          ends_at: string;
          id?: string;
          is_private?: boolean;
          kind?: Database["public"]["Enums"]["course_kind"];
          level: Database["public"]["Enums"]["course_level"];
          location_id: string;
          places?: number;
          price_member?: number;
          price_non_member?: number;
          prof_id?: string | null;
          series_id?: string | null;
          sport: Database["public"]["Enums"]["sport"];
          starts_at: string;
          status?: Database["public"]["Enums"]["course_status"];
          vacancy_notified_at?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          ends_at?: string;
          id?: string;
          is_private?: boolean;
          kind?: Database["public"]["Enums"]["course_kind"];
          level?: Database["public"]["Enums"]["course_level"];
          location_id?: string;
          places?: number;
          price_member?: number;
          price_non_member?: number;
          prof_id?: string | null;
          series_id?: string | null;
          sport?: Database["public"]["Enums"]["sport"];
          starts_at?: string;
          status?: Database["public"]["Enums"]["course_status"];
          vacancy_notified_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "courses_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "courses_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "courses_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "courses_prof_id_fkey";
            columns: ["prof_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "courses_prof_id_fkey";
            columns: ["prof_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "courses_series_id_fkey";
            columns: ["series_id"];
            isOneToOne: false;
            referencedRelation: "course_series";
            referencedColumns: ["id"];
          },
        ];
      };
      locations: {
        Row: {
          address: string;
          archived: boolean;
          created_at: string;
          id: string;
          is_default: boolean;
          maps_url: string;
          name: string;
        };
        ComputedFields: never;
        Insert: {
          address?: string;
          archived?: boolean;
          created_at?: string;
          id?: string;
          is_default?: boolean;
          maps_url?: string;
          name: string;
        };
        Update: {
          address?: string;
          archived?: boolean;
          created_at?: string;
          id?: string;
          is_default?: boolean;
          maps_url?: string;
          name?: string;
        };
        Relationships: [];
      };
      memberships: {
        Row: {
          amount: number;
          auto_renew: boolean;
          cancel_at_period_end: boolean;
          created_at: string;
          ends_on: string | null;
          id: string;
          months: number;
          paid_by: string | null;
          profile_id: string;
          source: Database["public"]["Enums"]["membership_source"];
          starts_on: string | null;
          status: Database["public"]["Enums"]["membership_status"];
          stripe_subscription_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          auto_renew?: boolean;
          cancel_at_period_end?: boolean;
          created_at?: string;
          ends_on?: string | null;
          id?: string;
          months: number;
          paid_by?: string | null;
          profile_id: string;
          source: Database["public"]["Enums"]["membership_source"];
          starts_on?: string | null;
          status?: Database["public"]["Enums"]["membership_status"];
          stripe_subscription_id?: string | null;
        };
        Update: {
          amount?: number;
          auto_renew?: boolean;
          cancel_at_period_end?: boolean;
          created_at?: string;
          ends_on?: string | null;
          id?: string;
          months?: number;
          paid_by?: string | null;
          profile_id?: string;
          source?: Database["public"]["Enums"]["membership_source"];
          starts_on?: string | null;
          status?: Database["public"]["Enums"]["membership_status"];
          stripe_subscription_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "memberships_paid_by_fkey";
            columns: ["paid_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memberships_paid_by_fkey";
            columns: ["paid_by"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memberships_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memberships_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_outbox: {
        Row: {
          attempts: number;
          claimed_at: string | null;
          course_id: string | null;
          created_at: string | null;
          error: string | null;
          id: number;
          kind: string;
          payload: NonNullable<Json>;
          profile_id: string;
          sent_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          attempts?: number;
          claimed_at?: string | null;
          course_id?: string | null;
          created_at?: string | null;
          error?: string | null;
          id?: number;
          kind: string;
          payload?: NonNullable<Json>;
          profile_id: string;
          sent_at?: string | null;
        };
        Update: {
          attempts?: number;
          claimed_at?: string | null;
          course_id?: string | null;
          created_at?: string | null;
          error?: string | null;
          id?: number;
          kind?: string;
          payload?: NonNullable<Json>;
          profile_id?: string;
          sent_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "notification_outbox_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "course_booking_counts";
            referencedColumns: ["course_id"];
          },
          {
            foreignKeyName: "notification_outbox_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notification_outbox_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notification_outbox_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      parent_consents: {
        Row: {
          confirmed_at: string | null;
          created_at: string;
          parent_email: string;
          profile_id: string;
          token: string;
        };
        ComputedFields: never;
        Insert: {
          confirmed_at?: string | null;
          created_at?: string;
          parent_email: string;
          profile_id: string;
          token?: string;
        };
        Update: {
          confirmed_at?: string | null;
          created_at?: string;
          parent_email?: string;
          profile_id?: string;
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "parent_consents_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "parent_consents_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          amount: number;
          beneficiary_profile_id: string | null;
          booking_id: string | null;
          created_at: string;
          currency: string;
          description: string;
          id: string;
          kind: Database["public"]["Enums"]["payment_kind"];
          membership_id: string | null;
          method: string | null;
          paid_at: string | null;
          payer_profile_id: string | null;
          receipt_no: number;
          refunded_at: string | null;
          status: Database["public"]["Enums"]["payment_state"];
          stripe_invoice_id: string | null;
          stripe_payment_intent_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          beneficiary_profile_id?: string | null;
          booking_id?: string | null;
          created_at?: string;
          currency?: string;
          description: string;
          id?: string;
          kind: Database["public"]["Enums"]["payment_kind"];
          membership_id?: string | null;
          method?: string | null;
          paid_at?: string | null;
          payer_profile_id?: string | null;
          receipt_no?: never;
          refunded_at?: string | null;
          status?: Database["public"]["Enums"]["payment_state"];
          stripe_invoice_id?: string | null;
          stripe_payment_intent_id?: string | null;
        };
        Update: {
          amount?: number;
          beneficiary_profile_id?: string | null;
          booking_id?: string | null;
          created_at?: string;
          currency?: string;
          description?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["payment_kind"];
          membership_id?: string | null;
          method?: string | null;
          paid_at?: string | null;
          payer_profile_id?: string | null;
          receipt_no?: never;
          refunded_at?: string | null;
          status?: Database["public"]["Enums"]["payment_state"];
          stripe_invoice_id?: string | null;
          stripe_payment_intent_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "payments_beneficiary_profile_id_fkey";
            columns: ["beneficiary_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_beneficiary_profile_id_fkey";
            columns: ["beneficiary_profile_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_membership_id_fkey";
            columns: ["membership_id"];
            isOneToOne: false;
            referencedRelation: "memberships";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_payer_profile_id_fkey";
            columns: ["payer_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_payer_profile_id_fkey";
            columns: ["payer_profile_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      pricing_settings: {
        Row: {
          child_discount_pct: number;
          child_max_age: number;
          default_course_price: number;
          id: boolean;
          price_12m: number;
          price_1m: number;
          price_3m: number;
          price_6m: number;
          student_discount_pct: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          child_discount_pct?: number;
          child_max_age?: number;
          default_course_price?: number;
          id?: boolean;
          price_12m: number;
          price_1m: number;
          price_3m: number;
          price_6m: number;
          student_discount_pct?: number;
          updated_at?: string;
        };
        Update: {
          child_discount_pct?: number;
          child_max_age?: number;
          default_course_price?: number;
          id?: boolean;
          price_12m?: number;
          price_1m?: number;
          price_3m?: number;
          price_6m?: number;
          student_discount_pct?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          age: number;
          auth_user_id: string | null;
          bjj_belt: Database["public"]["Enums"]["belt"] | null;
          coach_years: number | null;
          competition_awards: string | null;
          created_at: string;
          cv: string | null;
          email: string | null;
          first_name: string;
          id: string;
          is_student: boolean;
          language: Database["public"]["Enums"]["lang"];
          last_name: string;
          paid_until: string | null;
          parent_consent_at: string | null;
          parent_email: string | null;
          parent_profile_id: string | null;
          phone: string | null;
          prof_status: Database["public"]["Enums"]["prof_status"] | null;
          role: Database["public"]["Enums"]["user_role"];
          sports: Database["public"]["Enums"]["sport"][];
          stripe_customer_id: string | null;
          student_status: Database["public"]["Enums"]["student_status"];
          training_places: string | null;
          years_grappling: number | null;
          years_mma: number | null;
          is_account_active: boolean | null;
        };
        ComputedFields: "is_account_active";
        Insert: {
          age: number;
          auth_user_id?: string | null;
          bjj_belt?: Database["public"]["Enums"]["belt"] | null;
          coach_years?: number | null;
          competition_awards?: string | null;
          created_at?: string;
          cv?: string | null;
          email?: string | null;
          first_name: string;
          id?: string;
          is_student?: boolean;
          language?: Database["public"]["Enums"]["lang"];
          last_name: string;
          paid_until?: string | null;
          parent_consent_at?: string | null;
          parent_email?: string | null;
          parent_profile_id?: string | null;
          phone?: string | null;
          prof_status?: Database["public"]["Enums"]["prof_status"] | null;
          role?: Database["public"]["Enums"]["user_role"];
          sports: Database["public"]["Enums"]["sport"][];
          stripe_customer_id?: string | null;
          student_status?: Database["public"]["Enums"]["student_status"];
          training_places?: string | null;
          years_grappling?: number | null;
          years_mma?: number | null;
        };
        Update: {
          age?: number;
          auth_user_id?: string | null;
          bjj_belt?: Database["public"]["Enums"]["belt"] | null;
          coach_years?: number | null;
          competition_awards?: string | null;
          created_at?: string;
          cv?: string | null;
          email?: string | null;
          first_name?: string;
          id?: string;
          is_student?: boolean;
          language?: Database["public"]["Enums"]["lang"];
          last_name?: string;
          paid_until?: string | null;
          parent_consent_at?: string | null;
          parent_email?: string | null;
          parent_profile_id?: string | null;
          phone?: string | null;
          prof_status?: Database["public"]["Enums"]["prof_status"] | null;
          role?: Database["public"]["Enums"]["user_role"];
          sports?: Database["public"]["Enums"]["sport"][];
          stripe_customer_id?: string | null;
          student_status?: Database["public"]["Enums"]["student_status"];
          training_places?: string | null;
          years_grappling?: number | null;
          years_mma?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_parent_profile_id_fkey";
            columns: ["parent_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_parent_profile_id_fkey";
            columns: ["parent_profile_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      push_tokens: {
        Row: {
          platform: string;
          profile_id: string;
          token: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          platform: string;
          profile_id: string;
          token: string;
          updated_at?: string;
        };
        Update: {
          platform?: string;
          profile_id?: string;
          token?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "push_tokens_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "push_tokens_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      course_booking_counts: {
        Row: {
          booked: number | null;
          course_id: string;
        };
        ComputedFields: never;
        Insert: {
          booked?: never;
          course_id?: string | null;
        };
        Update: {
          booked?: never;
          course_id?: string | null;
        };
        Relationships: [];
      };
      public_profiles: {
        Row: {
          bjj_belt: Database["public"]["Enums"]["belt"] | null;
          display_role: string | null;
          first_name: string;
          id: string;
          last_name: string;
          sports: Database["public"]["Enums"]["sport"][];
        };
        ComputedFields: never;
        Insert: {
          bjj_belt?: Database["public"]["Enums"]["belt"] | null;
          display_role?: never;
          first_name?: string | null;
          id?: string | null;
          last_name?: string | null;
          sports?: Database["public"]["Enums"]["sport"][] | null;
        };
        Update: {
          bjj_belt?: Database["public"]["Enums"]["belt"] | null;
          display_role?: never;
          first_name?: string | null;
          id?: string | null;
          last_name?: string | null;
          sports?: Database["public"]["Enums"]["sport"][] | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      admin_mark_paid_current_year: { Args: { p_profile: string }; Returns: undefined };
      admin_set_prof_status: {
        Args: { p_profile: string; p_status: Database["public"]["Enums"]["prof_status"] };
        Returns: undefined;
      };
      admin_set_role: {
        Args: { p_profile: string; p_role: Database["public"]["Enums"]["user_role"] };
        Returns: undefined;
      };
      admin_update_pricing: { Args: { p: Json }; Returns: undefined };
      admin_upsert_location: { Args: { p: Json }; Returns: string };
      assign_prof: { Args: { p_course: string; p_prof: string }; Returns: undefined };
      attach_payment_intent: { Args: { p_intent: string; p_payment: string }; Returns: undefined };
      book_course: {
        Args: { p_course: string; p_profile?: string };
        Returns: {
          amount: number;
          booking_id: string;
          needs_payment: boolean;
        }[];
      };
      can_pay_for: { Args: { p_profile: string }; Returns: boolean };
      cancel_course: { Args: { p_course: string; p_scope: string }; Returns: number };
      check_parent_consent: { Args: { p_token: string }; Returns: boolean };
      claim_outbox: {
        Args: { p_limit: number };
        Returns: {
          attempts: number;
          child_first_name: string;
          course_id: string;
          id: number;
          kind: string;
          language: string;
          payload: Json;
          profile_id: string;
          sport: string;
          starts_at: string;
        }[];
      };
      confirm_parent_consent: { Args: { p_token: string }; Returns: boolean };
      confirm_payment: { Args: { p_intent: string; p_method: string }; Returns: string };
      course_participants: {
        Args: { p_course: string };
        Returns: {
          age: number;
          bjj_belt: Database["public"]["Enums"]["belt"];
          first_name: string;
          last_name: string;
          present: boolean;
          profile_id: string;
        }[];
      };
      create_child_profile: { Args: { p: Json }; Returns: string };
      create_course: { Args: { p: Json; p_repeat_until?: string }; Returns: string[] };
      current_account_active: { Args: Record<PropertyKey, never>; Returns: boolean };
      current_profile_id: { Args: Record<PropertyKey, never>; Returns: string };
      fail_payment: { Args: { p_intent: string }; Returns: undefined };
      invoke_send_push: { Args: Record<PropertyKey, never>; Returns: number };
      is_account_active: {
        Args: {
          p: Omit<
            Database["public"]["Tables"]["profiles"]["Row"],
            Database["public"]["Tables"]["profiles"]["ComputedFields"]
          >;
        };
        Returns: boolean;
      };
      is_active_prof: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_course_staff: { Args: { p_course: string }; Returns: boolean };
      is_member: { Args: { p_on?: string; p_profile: string }; Returns: boolean };
      is_self_or_child: { Args: { p_profile: string }; Returns: boolean };
      leave_slot: { Args: { p_course: string }; Returns: undefined };
      mark_refunded: { Args: { p_payment: string }; Returns: undefined };
      membership_price: {
        Args: { p_months: number; p_profile: string };
        Returns: {
          amount: number;
          base: number;
          discount_pct: number;
          reason: string;
        }[];
      };
      my_membership: {
        Args: { p_profile?: string };
        Returns: {
          auto_renew: boolean;
          cancel_at_period_end: boolean;
          is_member: boolean;
          source: Database["public"]["Enums"]["membership_source"];
          until: string;
        }[];
      };
      my_trial_status: {
        Args: { p_profile?: string };
        Returns: {
          trial_limit: number;
          used: number;
        }[];
      };
      notify_profile: { Args: { p_course: string; p_kind: string; p_profile: string }; Returns: undefined };
      process_course_schedule: { Args: Record<PropertyKey, never>; Returns: undefined };
      refunds_to_process: {
        Args: { p_limit: number };
        Returns: {
          amount: number;
          beneficiary_profile_id: string | null;
          booking_id: string | null;
          created_at: string;
          currency: string;
          description: string;
          id: string;
          kind: Database["public"]["Enums"]["payment_kind"];
          membership_id: string | null;
          method: string | null;
          paid_at: string | null;
          payer_profile_id: string | null;
          receipt_no: number;
          refunded_at: string | null;
          status: Database["public"]["Enums"]["payment_state"];
          stripe_invoice_id: string | null;
          stripe_payment_intent_id: string | null;
        }[];
        SetofOptions: {
          from: "*";
          to: "payments";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      register_push_token: { Args: { p_platform: string; p_token: string }; Returns: undefined };
      release_future_courses: { Args: { p_profile: string }; Returns: undefined };
      set_attendance: { Args: { p_course: string; p_present: boolean; p_profile: string }; Returns: undefined };
      set_belt: { Args: { p_belt: Database["public"]["Enums"]["belt"]; p_profile: string }; Returns: undefined };
      start_course_payment: {
        Args: { p_booking: string; p_payer: string };
        Returns: {
          amount: number;
          description: string;
          payment_id: string;
        }[];
      };
      take_slot: { Args: { p_course: string }; Returns: undefined };
      trial_used: { Args: { p_profile: string }; Returns: number };
      unbook_course: { Args: { p_course: string; p_profile?: string }; Returns: undefined };
      update_course: { Args: { p: Json; p_course: string; p_scope: string }; Returns: number };
    };
    Enums: {
      belt: "blanche" | "grise" | "jaune" | "orange" | "verte" | "bleue" | "violette" | "marron" | "noire";
      course_kind: "normal" | "competition";
      course_level: "adulte" | "enfant";
      course_status: "prevu" | "open_mat" | "annule";
      lang: "fr" | "de" | "en" | "ru";
      membership_source: "stripe_subscription" | "one_time" | "admin_year";
      membership_status: "pending" | "active" | "cancelled" | "ended";
      payment_kind: "course" | "membership";
      payment_state: "pending" | "succeeded" | "failed" | "refund_pending" | "refunded";
      prof_status: "en_attente" | "valide" | "refuse";
      sport: "jjb" | "grappling" | "mma";
      student_status: "aucun" | "en_attente" | "valide" | "refuse";
      user_role: "eleve" | "prof" | "admin";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      belt: ["blanche", "grise", "jaune", "orange", "verte", "bleue", "violette", "marron", "noire"],
      course_kind: ["normal", "competition"],
      course_level: ["adulte", "enfant"],
      course_status: ["prevu", "open_mat", "annule"],
      lang: ["fr", "de", "en", "ru"],
      membership_source: ["stripe_subscription", "one_time", "admin_year"],
      membership_status: ["pending", "active", "cancelled", "ended"],
      payment_kind: ["course", "membership"],
      payment_state: ["pending", "succeeded", "failed", "refund_pending", "refunded"],
      prof_status: ["en_attente", "valide", "refuse"],
      sport: ["jjb", "grappling", "mma"],
      student_status: ["aucun", "en_attente", "valide", "refuse"],
      user_role: ["eleve", "prof", "admin"],
    },
  },
} as const;
