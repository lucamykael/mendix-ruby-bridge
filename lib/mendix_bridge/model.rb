# frozen_string_literal: true

module MendixBridge
  module Model
    Attribute = Data.define(:name, :type, :required, :default, :options) do
      def to_h
        { name:, type:, required:, default:, **options }.compact
      end
    end

    Association = Data.define(:name, :target, :cardinality, :owner) do
      def to_h
        { name:, target:, cardinality:, owner: }.compact
      end
    end

    AccessRule = Data.define(:role, :create, :delete, :read, :write, :xpath) do
      def to_h
        {
          role:,
          create:,
          delete:,
          read:,
          write:,
          xpath:
        }.compact
      end
    end

    Entity = Data.define(
      :name,
      :persistable,
      :attributes,
      :associations,
      :access_rules
    ) do
      def to_h
        {
          name:,
          persistable:,
          attributes: attributes.map(&:to_h),
          associations: associations.map(&:to_h),
          access_rules: access_rules.map(&:to_h)
        }
      end
    end

    EnumerationValue = Data.define(:name, :caption) do
      def to_h
        { name:, caption: }
      end
    end

    Enumeration = Data.define(:name, :folder, :values) do
      def to_h
        { name:, folder:, values: values.map(&:to_h) }.compact
      end
    end

    FlowParameter = Data.define(:name, :type) do
      def to_h
        { name:, type: }
      end
    end

    Microflow = Data.define(
      :name,
      :parameters,
      :return_type,
      :folder,
      :body,
      :execute_roles
    ) do
      def to_h
        {
          name:,
          parameters: parameters.map(&:to_h),
          return_type:,
          folder:,
          body:,
          execute_roles:
        }.compact
      end
    end

    Page = Data.define(
      :name,
      :title,
      :layout,
      :folder,
      :parameters,
      :content,
      :view_roles
    ) do
      def to_h
        {
          name:,
          title:,
          layout:,
          folder:,
          parameters: parameters.map(&:to_h),
          content:,
          view_roles:
        }.compact
      end
    end

    ModuleRole = Data.define(:name, :description) do
      def to_h
        { name:, description: }.compact
      end
    end

    UserRole = Data.define(:name, :module_roles, :manage_all_roles) do
      def to_h
        { name:, module_roles:, manage_all_roles: }
      end
    end

    ProjectSecurity = Data.define(:level, :demo_users) do
      def to_h
        { level:, demo_users: }
      end
    end

    NavigationItem = Data.define(:caption, :action, :target) do
      def to_h
        { caption:, action:, target: }
      end
    end

    NavigationMenu = Data.define(:caption, :items) do
      def to_h
        { caption:, items: items.map(&:to_h) }
      end
    end

    RoleHomePage = Data.define(:role, :page) do
      def to_h
        { role:, page: }
      end
    end

    NavigationProfile = Data.define(
      :name,
      :home_page,
      :role_home_pages,
      :login_page,
      :not_found_page,
      :items
    ) do
      def to_h
        {
          name:,
          home_page:,
          role_home_pages: role_home_pages.map(&:to_h),
          login_page:,
          not_found_page:,
          items: items.map(&:to_h)
        }.compact
      end
    end

    AppModule = Data.define(
      :name,
      :entities,
      :enumerations,
      :microflows,
      :pages,
      :module_roles
    ) do
      def to_h
        {
          name:,
          entities: entities.map(&:to_h),
          enumerations: enumerations.map(&:to_h),
          microflows: microflows.map(&:to_h),
          pages: pages.map(&:to_h),
          module_roles: module_roles.map(&:to_h)
        }
      end
    end

    App = Data.define(
      :name,
      :version,
      :modules,
      :user_roles,
      :project_security,
      :navigation_profiles
    ) do
      def to_h
        {
          schema_version: 1,
          app: { name:, version: }.compact,
          modules: modules.map(&:to_h),
          user_roles: user_roles.map(&:to_h),
          project_security: project_security&.to_h,
          navigation_profiles: navigation_profiles.map(&:to_h)
        }
      end
    end
  end
end
