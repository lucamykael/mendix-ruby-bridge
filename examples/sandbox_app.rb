# frozen_string_literal: true

require_relative "../lib/mendix_bridge"

MendixBridge.app("RubyBridgeSandbox", version: "11.6.8") do
  modulo "MyFirstModule" do
    entity "Customer" do
      attribute "Name", :string, required: true
      attribute "Active", :boolean, default: true
    end

    entity "Order" do
      attribute "Number", :string, required: true
      attribute "Total", :decimal, default: 0

      association "Order_Customer",
        target: "MyFirstModule.Customer",
        cardinality: :one
    end
  end
end
