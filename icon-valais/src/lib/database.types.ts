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
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
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
    };
    Views: {
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
      create_child_profile: { Args: { p: Json }; Returns: string };
      current_profile_id: { Args: Record<PropertyKey, never>; Returns: string };
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
      set_belt: {
        Args: { p_belt: Database["public"]["Enums"]["belt"]; p_profile: string };
        Returns: undefined;
      };
    };
    Enums: {
      belt:
        | "blanche"
        | "grise"
        | "jaune"
        | "orange"
        | "verte"
        | "bleue"
        | "violette"
        | "marron"
        | "noire";
      lang: "fr" | "de" | "en" | "ru";
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      belt: [
        "blanche",
        "grise",
        "jaune",
        "orange",
        "verte",
        "bleue",
        "violette",
        "marron",
        "noire",
      ],
      lang: ["fr", "de", "en", "ru"],
      prof_status: ["en_attente", "valide", "refuse"],
      sport: ["jjb", "grappling", "mma"],
      student_status: ["aucun", "en_attente", "valide", "refuse"],
      user_role: ["eleve", "prof", "admin"],
    },
  },
} as const;
